'use strict';
require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const redis = require('../lib/redis');
const { publishTransaction } = require('../lib/rabbitmq');
const { requireAuth } = require('../lib/auth');
const { MercadoPagoConfig, Preference } = require('mercadopago');

const router = express.Router();

// POST /transactions/buy
router.post(
  '/buy',
  requireAuth,
  [
    body('event_id').isUUID().withMessage('Valid event_id required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { event_id } = req.body;

    try {
      const rawEvent = await redis.get(`event:${event_id}`);
      if (!rawEvent) {
        return res.status(404).json({ error: 'Event not found' });
      }
      const event = JSON.parse(rawEvent);

      if (event.status === 'suspended') {
        return res.status(409).json({ error: 'Event is suspended' });
      }

      // If nominada, check user doesn't already own a ticket for this event
      if (event.rules && event.rules.nominada) {
        const userTickets = await redis.smembers(`user:${req.user.wallet_address}:tickets`);
        const alreadyOwns = userTickets.some(t => t.startsWith(`${event_id}:`));
        if (alreadyOwns) {
          return res.status(409).json({ error: 'Nominada event: user already owns a ticket' });
        }
      }

      // Auto-assign next available ticket from pool
      let ticket_id = await redis.lpop(`event:${event_id}:tickets:pool`);

      // Fallback: pool missing (event created before pool support) — scan sequentially
      if (!ticket_id) {
        const available = parseInt((await redis.get(`event:${event_id}:available_tickets`)) || '0');
        if (available <= 0) {
          return res.status(409).json({ error: 'No tickets available' });
        }
        for (let i = 1; i <= event.total_tickets; i++) {
          const tid = `T${String(i).padStart(6, '0')}`;
          const owner = await redis.get(`ticket:${event_id}:${tid}:owner`);
          if (owner === 'null') {
            ticket_id = tid;
            break;
          }
        }
        if (!ticket_id) {
          return res.status(409).json({ error: 'No tickets available' });
        }
      }

      const tx_id = uuidv4();
      const pendingTx = {
        event_id,
        ticket_id,
        wallet_address: req.user.wallet_address,
        price: event.price
      };
      
      // Bloqueamos temporalmente la entrada mientras paga
      await redis.setex(`ticket:${event_id}:${ticket_id}:owner`, 900, 'pending_payment');
      await redis.setex(`pending_tx:${tx_id}`, 900, JSON.stringify(pendingTx));

      // Configurar Mercado Pago
      const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
      const preference = new Preference(client);

      const response = await preference.create({
        body: {
          items: [
            {
              id: ticket_id,
              title: `Entrada: ${event.name}`,
              quantity: 1,
              unit_price: Number(event.price),
              currency_id: 'ARS',
            }
          ],
          external_reference: tx_id,
          notification_url: process.env.PUBLIC_API_URL ? `${process.env.PUBLIC_API_URL}/api/transactions/mp/webhook` : undefined,
          back_urls: {
            success: `http://localhost/api/transactions/mp/success`,
            failure: `http://localhost/events/${event_id}?error=payment_failed`,
            pending: `http://localhost/events/${event_id}?error=payment_pending`
          }
        }
      });

      return res.status(200).json({
        init_point: response.sandbox_init_point || response.init_point,
        ticket_id,
        status: 'pending_payment',
        message: 'Redirigiendo a Mercado Pago...'
      });
    } catch (err) {
      console.error('[POST /buy] Error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /transactions/mp/success
router.get('/mp/success', async (req, res) => {
  const { payment_id, status, external_reference } = req.query;

  if (status !== 'approved') {
    return res.redirect(`http://localhost/events`);
  }

  try {
    const rawTx = await redis.get(`pending_tx:${external_reference}`);
    if (!rawTx) {
      // Si no está, probablemente el webhook ya lo procesó o expiró
      return res.redirect(`http://localhost/events`);
    }
    const pendingTx = JSON.parse(rawTx);

    // Evitar procesamiento duplicado
    await redis.del(`pending_tx:${external_reference}`);

    const tx = {
      tx_id: external_reference,
      type: 'buy',
      event_id: pendingTx.event_id,
      ticket_id: pendingTx.ticket_id,
      from_wallet: null,
      to_wallet: pendingTx.wallet_address,
      price: pendingTx.price,
      timestamp: new Date().toISOString(),
    };

    await redis.set(`ticket:${pendingTx.event_id}:${pendingTx.ticket_id}:owner`, pendingTx.wallet_address);
    await redis.decr(`event:${pendingTx.event_id}:available_tickets`);
    await redis.sadd(`user:${pendingTx.wallet_address}:tickets`, `${pendingTx.event_id}:${pendingTx.ticket_id}`);
    await redis.rpush(`txpool:${pendingTx.event_id}`, JSON.stringify(tx));
    await publishTransaction(tx);

    res.redirect(`http://localhost/events/${pendingTx.event_id}?success=true&ticket_id=${pendingTx.ticket_id}`);
  } catch (err) {
    console.error('[GET /mp/success] Error:', err.message);
    res.status(500).send("Error interno procesando el pago");
  }
});


// POST /transactions/mp/webhook (Manejo oficial de notificaciones de MP)
router.post('/mp/webhook', express.json(), async (req, res) => {
  try {
    const signatureHeader = req.headers['x-signature'];
    const requestId = req.headers['x-request-id'];
    const dataID = req.body?.data?.id;

    if (signatureHeader && process.env.MP_WEBHOOK_SECRET) {
      // Extraer ts y v1 del header x-signature (ej: ts=123,v1=abc)
      const parts = signatureHeader.split(',');
      let ts = '';
      let v1 = '';
      parts.forEach(p => {
        const [k, v] = p.split('=');
        if (k === 'ts') ts = v;
        if (k === 'v1') v1 = v;
      });

      // Calcular HMAC SHA256
      const manifest = `id:${dataID};request-id:${requestId};ts:${ts};`;
      const hmac = crypto.createHmac('sha256', process.env.MP_WEBHOOK_SECRET);
      hmac.update(manifest);
      const sha = hmac.digest('hex');

      if (sha !== v1) {
        console.warn('[Webhook] Invalid signature');
        return res.status(403).send('Invalid signature');
      }
    }

    if (req.body.type === 'payment' && req.body.action === 'payment.created') {
      const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
      const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${dataID}`, {
        headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
      });
      if (!paymentResponse.ok) throw new Error('Failed to fetch payment info');
      const paymentInfo = await paymentResponse.json();

      if (paymentInfo.status === 'approved') {
        const tx_id = paymentInfo.external_reference;
        const rawTx = await redis.get(`pending_tx:${tx_id}`);
        if (rawTx) {
          const pendingTx = JSON.parse(rawTx);
          await redis.del(`pending_tx:${tx_id}`);

          const tx = {
            tx_id: tx_id,
            type: pendingTx.type || 'buy',
            event_id: pendingTx.event_id,
            ticket_id: pendingTx.ticket_id,
            from_wallet: pendingTx.seller_wallet || null,
            to_wallet: pendingTx.wallet_address,
            price: pendingTx.price,
            timestamp: new Date().toISOString(),
          };

          await redis.set(`ticket:${pendingTx.event_id}:${pendingTx.ticket_id}:owner`, pendingTx.wallet_address);
          await redis.sadd(`user:${pendingTx.wallet_address}:tickets`, `${pendingTx.event_id}:${pendingTx.ticket_id}`);
          if (tx.type === 'resell') {
            await redis.set(`ticket:${pendingTx.event_id}:${pendingTx.ticket_id}:resales`, String(pendingTx.resale_count));
            await redis.del(`ticket:${pendingTx.event_id}:${pendingTx.ticket_id}:qr_secret`);
            await redis.srem(`user:${pendingTx.seller_wallet}:tickets`, `${pendingTx.event_id}:${pendingTx.ticket_id}`);
          }
          await redis.rpush(`txpool:${pendingTx.event_id}`, JSON.stringify(tx));
          await publishTransaction(tx);
          console.log(`[Webhook] Processed ${tx.type} payment for ${tx_id}`);
        }
      }
    }
    res.status(200).send('OK');
  } catch (err) {
    console.error('[Webhook Error]', err);
    res.status(500).send('Internal Error');
  }
});

// POST /transactions/list — poner ticket en venta
router.post(
  '/list',
  requireAuth,
  [
    body('event_id').isUUID().withMessage('Valid event_id required'),
    body('ticket_id').notEmpty().withMessage('ticket_id required'),
    body('price').isFloat({ min: 0 }).withMessage('Valid price required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { event_id, ticket_id, price } = req.body;

    try {
      const rawEvent = await redis.get(`event:${event_id}`);
      if (!rawEvent) return res.status(404).json({ error: 'Event not found' });
      const event = JSON.parse(rawEvent);

      if (event.status === 'suspended') return res.status(409).json({ error: 'Event is suspended' });
      if (event.rules?.nominada) return res.status(409).json({ error: 'Nominada event: resale not allowed' });

      const owner = await redis.get(`ticket:${event_id}:${ticket_id}:owner`);
      if (!owner) return res.status(404).json({ error: 'Ticket not found' });
      if (owner !== req.user.wallet_address) return res.status(403).json({ error: 'You do not own this ticket' });

      const resaleCountRaw = await redis.get(`ticket:${event_id}:${ticket_id}:resales`);
      const resale_count = parseInt(resaleCountRaw || '0');
      if (event.rules?.max_reventas != null && resale_count >= event.rules.max_reventas) {
        return res.status(409).json({ error: `Max resales (${event.rules.max_reventas}) reached` });
      }

      if (event.rules?.precio_max != null) {
        const maxPrice = event.price * (1 + event.rules.precio_max / 100);
        if (price > maxPrice) {
          return res.status(400).json({ error: `Price exceeds maximum allowed (${maxPrice.toFixed(0)})` });
        }
      }

      if (event.rules?.ventana_venta) {
        const eventDate = new Date(event.date).getTime();
        const ventanaMs = event.rules.ventana_venta * 60 * 60 * 1000;
        if (Date.now() >= eventDate - ventanaMs) {
          return res.status(409).json({ error: 'Resale window has closed' });
        }
      }

      const existing = await redis.hget(`event:${event_id}:listings`, ticket_id);
      if (existing) return res.status(409).json({ error: 'Ticket is already listed' });

      const listing = { seller_wallet: req.user.wallet_address, price, listed_at: new Date().toISOString(), resale_count };
      await redis.hset(`event:${event_id}:listings`, ticket_id, JSON.stringify(listing));

      return res.status(201).json({ ticket_id, price, status: 'listed' });
    } catch (err) {
      console.error('[POST /list] Error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// DELETE /transactions/list/:event_id/:ticket_id — cancelar venta
router.delete(
  '/list/:event_id/:ticket_id',
  requireAuth,
  [
    param('event_id').isUUID().withMessage('Valid event_id required'),
    param('ticket_id').notEmpty().withMessage('ticket_id required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { event_id, ticket_id } = req.params;

    try {
      const raw = await redis.hget(`event:${event_id}:listings`, ticket_id);
      if (!raw) return res.status(404).json({ error: 'Listing not found' });

      const listing = JSON.parse(raw);
      if (listing.seller_wallet !== req.user.wallet_address) {
        return res.status(403).json({ error: 'You did not list this ticket' });
      }

      await redis.hdel(`event:${event_id}:listings`, ticket_id);
      return res.json({ status: 'unlisted' });
    } catch (err) {
      console.error('[DELETE /list] Error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /transactions/listings/:event_id — ver ofertas de reventa de un evento
router.get(
  '/listings/:event_id',
  [param('event_id').isUUID().withMessage('Valid event_id required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
      const all = await redis.hgetall(`event:${req.params.event_id}:listings`);
      if (!all) return res.json([]);

      const listings = Object.entries(all).map(([ticket_id, raw]) => ({
        ticket_id,
        ...JSON.parse(raw),
      }));

      listings.sort((a, b) => a.price - b.price);
      return res.json(listings);
    } catch (err) {
      console.error('[GET /listings] Error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST /transactions/buy-listed — comprar una entrada en reventa
router.post(
  '/buy-listed',
  requireAuth,
  [
    body('event_id').isUUID().withMessage('Valid event_id required'),
    body('ticket_id').notEmpty().withMessage('ticket_id required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { event_id, ticket_id } = req.body;

    try {
      const rawEvent = await redis.get(`event:${event_id}`);
      if (!rawEvent) return res.status(404).json({ error: 'Event not found' });
      const event = JSON.parse(rawEvent);

      if (event.status === 'suspended') return res.status(409).json({ error: 'Event is suspended' });

      const raw = await redis.hget(`event:${event_id}:listings`, ticket_id);
      if (!raw) return res.status(404).json({ error: 'Listing not found' });
      const listing = JSON.parse(raw);

      if (listing.seller_wallet === req.user.wallet_address) {
        return res.status(409).json({ error: 'Cannot buy your own listing' });
      }

      if (event.rules?.nominada) {
        return res.status(409).json({ error: 'Nominada event: resale not allowed' });
      }

      const resaleCountRaw = await redis.get(`ticket:${event_id}:${ticket_id}:resales`);
      const resale_count = parseInt(resaleCountRaw || '0');

      const tx_id = uuidv4();
      const pendingTx = {
        event_id,
        ticket_id,
        wallet_address: req.user.wallet_address,
        seller_wallet: listing.seller_wallet,
        price: listing.price,
        resale_count: resale_count + 1,
        type: 'resell'
      };

      // Lock ticket temporarily
      await redis.setex(`ticket:${event_id}:${ticket_id}:owner`, 900, 'pending_payment');
      await redis.setex(`pending_tx:${tx_id}`, 900, JSON.stringify(pendingTx));
      await redis.hdel(`event:${event_id}:listings`, ticket_id);

      const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
      const preference = new Preference(client);

      const response = await preference.create({
        body: {
          items: [
            {
              id: ticket_id,
              title: `Reventa Entrada: ${event.name}`,
              quantity: 1,
              unit_price: Number(listing.price),
              currency_id: 'ARS',
            }
          ],
          external_reference: tx_id,
          notification_url: process.env.PUBLIC_API_URL ? `${process.env.PUBLIC_API_URL}/api/transactions/mp/webhook` : undefined,
          back_urls: {
            success: `http://localhost/api/transactions/mp/success`,
            failure: `http://localhost/events/${event_id}?error=payment_failed`,
            pending: `http://localhost/events/${event_id}?error=payment_pending`
          }
        }
      });

      return res.status(200).json({
        init_point: response.sandbox_init_point || response.init_point,
        ticket_id,
        status: 'pending_payment',
        message: 'Redirigiendo a Mercado Pago...'
      });
    } catch (err) {
      console.error('[POST /buy-listed] Error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST /transactions/resell
router.post(
  '/resell',
  requireAuth,
  [
    body('event_id').isUUID().withMessage('Valid event_id required'),
    body('ticket_id').notEmpty().withMessage('ticket_id required'),
    body('price').isFloat({ min: 0 }).withMessage('Valid price required'),
    body('to_wallet').matches(/^0x[0-9a-f]{8}$/).withMessage('Valid to_wallet address required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { event_id, ticket_id, price, to_wallet } = req.body;

    try {
      const rawEvent = await redis.get(`event:${event_id}`);
      if (!rawEvent) {
        return res.status(404).json({ error: 'Event not found' });
      }
      const event = JSON.parse(rawEvent);

      if (event.status === 'suspended') {
        return res.status(409).json({ error: 'Event is suspended' });
      }

      if (event.rules && event.rules.nominada) {
        return res.status(409).json({ error: 'Nominada event: resale not allowed' });
      }

      const owner = await redis.get(`ticket:${event_id}:${ticket_id}:owner`);
      if (owner === null) {
        return res.status(404).json({ error: 'Ticket not found' });
      }
      if (owner !== req.user.wallet_address) {
        return res.status(403).json({ error: 'You do not own this ticket' });
      }

      if (event.rules?.precio_max != null) {
        const maxPrice = event.price * (1 + event.rules.precio_max / 100);
        if (price > maxPrice) {
          return res
            .status(400)
            .json({ error: `Resale price exceeds maximum allowed (${maxPrice.toFixed(0)})` });
        }
      }

      const resaleCountRaw = await redis.get(`ticket:${event_id}:${ticket_id}:resales`);
      const resale_count = parseInt(resaleCountRaw || '0');
      if (resale_count >= event.rules.max_reventas) {
        return res
          .status(409)
          .json({ error: `Max resales (${event.rules.max_reventas}) reached for this ticket` });
      }

      // Validate ventana_venta: current time must be before event.date - ventana_venta hours
      const eventDate = new Date(event.date).getTime();
      const ventanaMs = event.rules.ventana_venta * 60 * 60 * 1000;
      const now = Date.now();
      if (now >= eventDate - ventanaMs) {
        return res.status(409).json({ error: 'Resale window has closed' });
      }

      const tx = {
        tx_id: uuidv4(),
        type: 'resell',
        event_id,
        ticket_id,
        from_wallet: req.user.wallet_address,
        to_wallet,
        price,
        timestamp: new Date().toISOString(),
      };

      await redis.set(`ticket:${event_id}:${ticket_id}:owner`, to_wallet);
      await redis.set(`ticket:${event_id}:${ticket_id}:resales`, String(resale_count + 1));
      await redis.del(`ticket:${event_id}:${ticket_id}:qr_secret`);
      await redis.srem(`user:${req.user.wallet_address}:tickets`, `${event_id}:${ticket_id}`);
      await redis.sadd(`user:${to_wallet}:tickets`, `${event_id}:${ticket_id}`);
      await redis.rpush(`txpool:${event_id}`, JSON.stringify(tx));
      await publishTransaction(tx);

      return res.status(202).json({ tx_id: tx.tx_id, status: 'pending' });
    } catch (err) {
      console.error('[POST /resell] Error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /transactions/my-tickets
router.get('/my-tickets', requireAuth, async (req, res) => {
  try {
    const entries = await redis.smembers(`user:${req.user.wallet_address}:tickets`);

    if (!entries || entries.length === 0) {
      return res.json([]);
    }

    const eventCache = {};
    const result = [];

    for (const entry of entries) {
      const [event_id, ticket_id] = entry.split(':');

      if (!eventCache[event_id]) {
        const raw = await redis.get(`event:${event_id}`);
        eventCache[event_id] = raw ? JSON.parse(raw) : null;
      }
      const event = eventCache[event_id];
      if (!event) continue;

      const resales = await redis.get(`ticket:${event_id}:${ticket_id}:resales`);
      const listingRaw = await redis.hget(`event:${event_id}:listings`, ticket_id);
      const listing = listingRaw ? JSON.parse(listingRaw) : null;

      result.push({
        event_id,
        event_name: event.name,
        event_rules: event.rules,
        event_price: event.price,
        event_status: event.status,
        ticket_id,
        owner_wallet: req.user.wallet_address,
        resale_count: parseInt(resales || '0'),
        listed: !!listing,
        listing_price: listing?.price ?? null,
      });
    }

    return res.json(result);
  } catch (err) {
    console.error('[GET /my-tickets] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /transactions/qr-token/:event_id/:ticket_id
router.get(
  '/qr-token/:event_id/:ticket_id',
  requireAuth,
  [
    param('event_id').isUUID().withMessage('Valid event_id required'),
    param('ticket_id').notEmpty().withMessage('ticket_id required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { event_id, ticket_id } = req.params;

    try {
      const owner = await redis.get(`ticket:${event_id}:${ticket_id}:owner`);
      if (!owner) return res.status(404).json({ error: 'Ticket not found' });
      if (owner !== req.user.wallet_address) return res.status(403).json({ error: 'You do not own this ticket' });

      let secret = await redis.get(`ticket:${event_id}:${ticket_id}:qr_secret`);
      if (!secret) {
        secret = crypto.randomBytes(32).toString('hex');
        await redis.set(`ticket:${event_id}:${ticket_id}:qr_secret`, secret);
      }

      const token = jwt.sign(
        { event_id, ticket_id, wallet: req.user.wallet_address },
        secret,
        { expiresIn: 60 }
      );

      return res.json({ token, expires_at: Math.floor(Date.now() / 1000) + 60 });
    } catch (err) {
      console.error('[GET /qr-token] Error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /transactions/status/:tx_id
router.get(
  '/status/:tx_id',
  requireAuth,
  [param('tx_id').isUUID().withMessage('Valid tx_id required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { tx_id } = req.params;

    try {
      const eventIds = await redis.lrange('events:list', 0, -1);

      // Search in blockchain first
      for (const event_id of eventIds) {
        const blocks = await redis.lrange(`blockchain:${event_id}`, 0, -1);
        for (const rawBlock of blocks) {
          const block = JSON.parse(rawBlock);
          if (block.transactions && Array.isArray(block.transactions)) {
            const found = block.transactions.find((t) => t.tx_id === tx_id);
            if (found) {
              return res.json({
                status: 'confirmed',
                block_index: block.index,
                block_hash: block.hash || null,
                tx: found,
              });
            }
          }
        }
      }

      // Search in txpool
      for (const event_id of eventIds) {
        const txs = await redis.lrange(`txpool:${event_id}`, 0, -1);
        for (const rawTx of txs) {
          const tx = JSON.parse(rawTx);
          if (tx.tx_id === tx_id) {
            return res.json({ status: 'pending', tx });
          }
        }
      }

      return res.status(404).json({ error: 'Transaction not found' });
    } catch (err) {
      console.error('[GET /status/:tx_id] Error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;

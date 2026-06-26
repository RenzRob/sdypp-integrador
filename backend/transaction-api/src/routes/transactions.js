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

const router = express.Router();

function isEventPast(event) {
  if (!event?.date) return false;
  return Date.now() >= new Date(event.date).getTime();
}

function isEventInactive(event) {
  return event.status === 'suspended' || event.status === 'completed' || isEventPast(event);
}

// ─── Rutas de compra ──────────────────────────────────────────────────────

// POST /transactions/buy
router.post(
  '/buy',
  requireAuth,
  [body('event_id').isUUID().withMessage('Valid event_id required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { event_id } = req.body;

    try {
      const rawEvent = await redis.get(`event:${event_id}`);
      if (!rawEvent) return res.status(404).json({ error: 'Event not found' });
      const event = JSON.parse(rawEvent);

      if (event.status === 'suspended') return res.status(409).json({ error: 'Event is suspended' });
      if (event.status === 'completed' || isEventPast(event)) return res.status(409).json({ error: 'Event has ended' });

      if (event.rules?.nominada) {
        const userTickets = await redis.smembers(`user:${req.user.wallet_address}:tickets`);
        if (userTickets.some(t => t.startsWith(`${event_id}:`))) {
          return res.status(409).json({ error: 'Nominada event: user already owns a ticket' });
        }
      }

      let ticket_id = await redis.lpop(`event:${event_id}:tickets:pool`);

      if (!ticket_id) {
        const available = parseInt((await redis.get(`event:${event_id}:available_tickets`)) || '0');
        if (available <= 0) return res.status(409).json({ error: 'No tickets available' });
        for (let i = 1; i <= event.total_tickets; i++) {
          const tid = `T${String(i).padStart(6, '0')}`;
          const owner = await redis.get(`ticket:${event_id}:${tid}:owner`);
          if (owner === 'null') { ticket_id = tid; break; }
        }
        if (!ticket_id) return res.status(409).json({ error: 'No tickets available' });
      }

      const tx_id = uuidv4();
      const pendingTx = {
        type: 'buy',
        event_id,
        ticket_id,
        wallet_address: req.user.wallet_address,
        price: event.price,
        event_name: event.name,
      };

      await redis.setex(`ticket:${event_id}:${ticket_id}:owner`, 900, 'pending_payment');
      await redis.setex(`pending_tx:${tx_id}`, 900, JSON.stringify(pendingTx));

      return res.status(200).json({
        tx_id,
        ticket_id,
        event_id,
        event_name: event.name,
        price: event.price,
        status: 'pending_payment',
      });
    } catch (err) {
      console.error('[POST /buy] Error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST /transactions/buy-listed
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
      if (event.status === 'completed' || isEventPast(event)) return res.status(409).json({ error: 'Event has ended' });
      if (event.rules?.nominada) return res.status(409).json({ error: 'Nominada event: resale not allowed' });

      const raw = await redis.hget(`event:${event_id}:listings`, ticket_id);
      if (!raw) return res.status(404).json({ error: 'Listing not found' });
      const listing = JSON.parse(raw);

      if (listing.seller_wallet === req.user.wallet_address) {
        return res.status(409).json({ error: 'Cannot buy your own listing' });
      }

      const resaleCountRaw = await redis.get(`ticket:${event_id}:${ticket_id}:resales`);
      const resale_count = parseInt(resaleCountRaw || '0');

      const tx_id = uuidv4();
      const pendingTx = {
        type: 'resell',
        event_id,
        ticket_id,
        wallet_address: req.user.wallet_address,
        seller_wallet: listing.seller_wallet,
        price: listing.price,
        resale_count: resale_count + 1,
        event_name: event.name,
      };

      await redis.setex(`ticket:${event_id}:${ticket_id}:owner`, 900, 'pending_payment');
      await redis.hdel(`event:${event_id}:listings`, ticket_id);
      await redis.setex(`pending_tx:${tx_id}`, 900, JSON.stringify(pendingTx));

      return res.status(200).json({
        tx_id,
        ticket_id,
        event_id,
        event_name: pendingTx.event_name,
        price: listing.price,
        status: 'pending_payment',
      });
    } catch (err) {
      console.error('[POST /buy-listed] Error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Rutas de reventa directa ─────────────────────────────────────────────

// POST /transactions/list
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
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { event_id, ticket_id, price } = req.body;

    try {
      const rawEvent = await redis.get(`event:${event_id}`);
      if (!rawEvent) return res.status(404).json({ error: 'Event not found' });
      const event = JSON.parse(rawEvent);

      if (event.status === 'suspended') return res.status(409).json({ error: 'Event is suspended' });
      if (event.status === 'completed' || isEventPast(event)) return res.status(409).json({ error: 'Event has ended' });
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

// DELETE /transactions/list/:event_id/:ticket_id
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

// GET /transactions/listings/:event_id
router.get(
  '/listings/:event_id',
  [param('event_id').isUUID().withMessage('Valid event_id required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
      const all = await redis.hgetall(`event:${req.params.event_id}:listings`);
      if (!all) return res.json([]);

      const listings = Object.entries(all)
        .map(([ticket_id, raw]) => ({ ticket_id, ...JSON.parse(raw) }))
        .sort((a, b) => a.price - b.price);

      return res.json(listings);
    } catch (err) {
      console.error('[GET /listings] Error:', err.message);
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
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { event_id, ticket_id, price, to_wallet } = req.body;

    try {
      const rawEvent = await redis.get(`event:${event_id}`);
      if (!rawEvent) return res.status(404).json({ error: 'Event not found' });
      const event = JSON.parse(rawEvent);

      if (event.status === 'suspended') return res.status(409).json({ error: 'Event is suspended' });
      if (event.status === 'completed' || isEventPast(event)) return res.status(409).json({ error: 'Event has ended' });
      if (event.rules?.nominada) return res.status(409).json({ error: 'Nominada event: resale not allowed' });

      const owner = await redis.get(`ticket:${event_id}:${ticket_id}:owner`);
      if (owner === null) return res.status(404).json({ error: 'Ticket not found' });
      if (owner !== req.user.wallet_address) return res.status(403).json({ error: 'You do not own this ticket' });

      if (event.rules?.precio_max != null) {
        const maxPrice = event.price * (1 + event.rules.precio_max / 100);
        if (price > maxPrice) {
          return res.status(400).json({ error: `Resale price exceeds maximum allowed (${maxPrice.toFixed(0)})` });
        }
      }

      const resaleCountRaw = await redis.get(`ticket:${event_id}:${ticket_id}:resales`);
      const resale_count = parseInt(resaleCountRaw || '0');
      if (resale_count >= event.rules.max_reventas) {
        return res.status(409).json({ error: `Max resales (${event.rules.max_reventas}) reached` });
      }

      const eventDate = new Date(event.date).getTime();
      const ventanaMs = event.rules.ventana_venta * 60 * 60 * 1000;
      if (Date.now() >= eventDate - ventanaMs) {
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

// ─── Rutas de usuario ─────────────────────────────────────────────────────

// GET /transactions/my-tickets
router.get('/my-tickets', requireAuth, async (req, res) => {
  try {
    const entries = await redis.smembers(`user:${req.user.wallet_address}:tickets`);
    if (!entries || entries.length === 0) return res.json([]);

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

// ─── Checkout simulado ────────────────────────────────────────────────────

// POST /transactions/checkout/confirm — confirma una reserva pendiente
router.post(
  '/checkout/confirm',
  requireAuth,
  [body('tx_id').isUUID().withMessage('Valid tx_id required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { tx_id } = req.body;

    try {
      const rawTx = await redis.getdel(`pending_tx:${tx_id}`);
      if (!rawTx) return res.status(404).json({ error: 'Sesión de pago no encontrada o expirada' });
      const p = JSON.parse(rawTx);

      if (p.wallet_address !== req.user.wallet_address) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const tx = {
        tx_id,
        type: p.type,
        event_id: p.event_id,
        ticket_id: p.ticket_id,
        from_wallet: p.seller_wallet || null,
        to_wallet: p.wallet_address,
        price: p.price,
        timestamp: new Date().toISOString(),
      };

      await redis.set(`ticket:${p.event_id}:${p.ticket_id}:owner`, p.wallet_address);
      await redis.sadd(`user:${p.wallet_address}:tickets`, `${p.event_id}:${p.ticket_id}`);

      if (p.type === 'buy') {
        await redis.decr(`event:${p.event_id}:available_tickets`);
      } else if (p.type === 'resell') {
        await redis.set(`ticket:${p.event_id}:${p.ticket_id}:resales`, String(p.resale_count));
        await redis.del(`ticket:${p.event_id}:${p.ticket_id}:qr_secret`);
        await redis.srem(`user:${p.seller_wallet}:tickets`, `${p.event_id}:${p.ticket_id}`);
      }

      await redis.rpush(`txpool:${p.event_id}`, JSON.stringify(tx));
      await publishTransaction(tx);

      return res.status(200).json({ tx_id, ticket_id: p.ticket_id, event_id: p.event_id, status: 'confirmed' });
    } catch (err) {
      console.error('[POST /checkout/confirm] Error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// DELETE /transactions/checkout/:tx_id — cancela la reserva y libera el ticket
router.delete(
  '/checkout/:tx_id',
  requireAuth,
  [param('tx_id').isUUID().withMessage('Valid tx_id required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { tx_id } = req.params;

    try {
      const rawTx = await redis.getdel(`pending_tx:${tx_id}`);
      if (!rawTx) return res.json({ status: 'cancelled' }); // ya expiró, nada que hacer

      const p = JSON.parse(rawTx);
      if (p.wallet_address !== req.user.wallet_address) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      await redis.set(`ticket:${p.event_id}:${p.ticket_id}:owner`, 'null');
      if (p.type === 'buy') {
        await redis.rpush(`event:${p.event_id}:tickets:pool`, p.ticket_id);
        await redis.incr(`event:${p.event_id}:available_tickets`);
      } else if (p.type === 'resell' && p.seller_wallet) {
        await redis.set(`ticket:${p.event_id}:${p.ticket_id}:owner`, p.seller_wallet);
      }

      return res.json({ status: 'cancelled' });
    } catch (err) {
      console.error('[DELETE /checkout/:tx_id] Error:', err.message);
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
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { tx_id } = req.params;

    try {
      const eventIds = await redis.lrange('events:list', 0, -1);

      for (const event_id of eventIds) {
        const blocks = await redis.lrange(`blockchain:${event_id}`, 0, -1);
        for (const rawBlock of blocks) {
          const block = JSON.parse(rawBlock);
          const found = block.transactions?.find(t => t.tx_id === tx_id);
          if (found) return res.json({ status: 'confirmed', block_index: block.index, block_hash: block.hash || null, tx: found });
        }
      }

      for (const event_id of eventIds) {
        const txs = await redis.lrange(`txpool:${event_id}`, 0, -1);
        for (const rawTx of txs) {
          const tx = JSON.parse(rawTx);
          if (tx.tx_id === tx_id) return res.json({ status: 'pending', tx });
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

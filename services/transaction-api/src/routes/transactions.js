'use strict';
require('dotenv').config();
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const redis = require('../lib/redis');
const { publishTransaction } = require('../lib/rabbitmq');
const { requireAuth } = require('../lib/auth');

const router = express.Router();

// POST /transactions/buy
router.post(
  '/buy',
  requireAuth,
  [
    body('event_id').isUUID().withMessage('Valid event_id required'),
    body('ticket_id').notEmpty().withMessage('ticket_id required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { event_id, ticket_id } = req.body;

    try {
      const rawEvent = await redis.get(`event:${event_id}`);
      if (!rawEvent) {
        return res.status(404).json({ error: 'Event not found' });
      }
      const event = JSON.parse(rawEvent);

      const owner = await redis.get(`ticket:${event_id}:${ticket_id}:owner`);
      if (owner === null) {
        return res.status(404).json({ error: 'Ticket not found' });
      }
      if (owner !== 'null') {
        return res.status(409).json({ error: 'Ticket is already owned' });
      }

      // If nominada, check user doesn't already own a ticket for this event
      if (event.rules && event.rules.nominada) {
        for (let i = 1; i <= event.total_tickets; i++) {
          const tid = `T${String(i).padStart(4, '0')}`;
          const o = await redis.get(`ticket:${event_id}:${tid}:owner`);
          if (o === req.user.wallet_address) {
            return res.status(409).json({ error: 'Nominada event: user already owns a ticket' });
          }
        }
      }

      const tx = {
        tx_id: uuidv4(),
        type: 'buy',
        event_id,
        ticket_id,
        from_wallet: null,
        to_wallet: req.user.wallet_address,
        price: event.price,
        timestamp: new Date().toISOString(),
      };

      await redis.set(`ticket:${event_id}:${ticket_id}:owner`, req.user.wallet_address);
      await redis.rpush(`txpool:${event_id}`, JSON.stringify(tx));
      await publishTransaction(tx);

      return res.status(202).json({
        tx_id: tx.tx_id,
        status: 'pending',
        message: 'Transacción encolada para minería',
      });
    } catch (err) {
      console.error('[POST /buy] Error:', err.message);
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

      if (price > event.rules.precio_max) {
        return res
          .status(400)
          .json({ error: `Resale price exceeds maximum allowed (${event.rules.precio_max})` });
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
    const eventIds = await redis.lrange('events:list', 0, -1);
    const result = [];

    for (const event_id of eventIds) {
      const rawEvent = await redis.get(`event:${event_id}`);
      if (!rawEvent) continue;
      const event = JSON.parse(rawEvent);

      for (let i = 1; i <= event.total_tickets; i++) {
        const ticket_id = `T${String(i).padStart(4, '0')}`;
        const owner = await redis.get(`ticket:${event_id}:${ticket_id}:owner`);
        if (owner === req.user.wallet_address) {
          const resales = await redis.get(`ticket:${event_id}:${ticket_id}:resales`);
          result.push({
            event_id,
            event_name: event.name,
            ticket_id,
            owner_wallet: owner,
            resale_count: parseInt(resales || '0'),
          });
        }
      }
    }

    return res.json(result);
  } catch (err) {
    console.error('[GET /my-tickets] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

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

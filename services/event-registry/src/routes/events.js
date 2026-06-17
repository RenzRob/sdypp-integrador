'use strict';
require('dotenv').config();
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const redis = require('../lib/redis');
const { requireAdmin } = require('../lib/auth');

const router = express.Router();

// GET /events
router.get('/', async (req, res) => {
  try {
    const eventIds = await redis.lrange('events:list', 0, -1);
    if (!eventIds || eventIds.length === 0) {
      return res.json([]);
    }

    const events = [];
    for (const id of eventIds) {
      const raw = await redis.get(`event:${id}`);
      if (raw) {
        const ev = JSON.parse(raw);
        const { genesis_block_hash, ...safeEvent } = ev;
        events.push(safeEvent);
      }
    }

    return res.json(events);
  } catch (err) {
    console.error('[GET /events] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /events (admin only)
router.post(
  '/',
  requireAdmin,
  [
    body('name').notEmpty().withMessage('Event name required'),
    body('description').notEmpty().withMessage('Description required'),
    body('date').isISO8601().withMessage('Valid ISO8601 date required'),
    body('venue').notEmpty().withMessage('Venue required'),
    body('total_tickets').isInt({ min: 1 }).withMessage('total_tickets must be a positive integer'),
    body('price').isFloat({ min: 0 }).withMessage('price must be a non-negative number'),
    body('rules.precio_max').isFloat({ min: 0 }).withMessage('rules.precio_max required'),
    body('rules.max_reventas').isInt({ min: 0 }).withMessage('rules.max_reventas required'),
    body('rules.nominada').isBoolean().withMessage('rules.nominada must be boolean'),
    body('rules.ventana_venta').isInt({ min: 0 }).withMessage('rules.ventana_venta required (hours)'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { name, description, date, venue, total_tickets, price, rules } = req.body;

    try {
      const event_id = uuidv4();
      const timestamp = new Date().toISOString();

      const genesisBlock = {
        index: 0,
        timestamp,
        previous_hash: '0'.repeat(64),
        nonce: 0,
        transactions: [],
        block_type: 'genesis',
        rules,
        event_id,
        name,
        total_tickets,
        price,
      };

      const genesis_block_hash = crypto
        .createHash('sha256')
        .update(JSON.stringify(genesisBlock))
        .digest('hex');

      const event = {
        id: event_id,
        name,
        description,
        date,
        venue,
        creator_id: req.user.id,
        creator_wallet: req.user.wallet_address,
        total_tickets,
        price,
        rules,
        genesis_block_hash,
        status: 'active',
        created_at: timestamp,
      };

      await redis.set(`event:${event_id}`, JSON.stringify(event));
      await redis.lpush('events:list', event_id);

      // Initialize tickets
      for (let i = 0; i < total_tickets; i++) {
        const ticket_id = `T${String(i + 1).padStart(4, '0')}`;
        await redis.set(`ticket:${event_id}:${ticket_id}:owner`, 'null');
        await redis.set(`ticket:${event_id}:${ticket_id}:resales`, '0');
      }

      // Save genesis block to blockchain
      await redis.rpush(`blockchain:${event_id}`, JSON.stringify(genesisBlock));

      return res.status(201).json(event);
    } catch (err) {
      console.error('[POST /events] Error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /events/:id
router.get(
  '/:id',
  [param('id').isUUID().withMessage('Invalid event ID')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
      const raw = await redis.get(`event:${req.params.id}`);
      if (!raw) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const event = JSON.parse(raw);
      const blockchain_length = await redis.llen(`blockchain:${req.params.id}`);

      return res.json({ ...event, blockchain_length });
    } catch (err) {
      console.error('[GET /events/:id] Error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /events/:id/blockchain
router.get(
  '/:id/blockchain',
  [param('id').isUUID().withMessage('Invalid event ID')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
      const raw = await redis.get(`event:${req.params.id}`);
      if (!raw) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const blocks = await redis.lrange(`blockchain:${req.params.id}`, 0, -1);
      const parsed = blocks.map((b) => JSON.parse(b));

      return res.json(parsed);
    } catch (err) {
      console.error('[GET /events/:id/blockchain] Error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /events/:id/tickets
router.get(
  '/:id/tickets',
  [param('id').isUUID().withMessage('Invalid event ID')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
      const raw = await redis.get(`event:${req.params.id}`);
      if (!raw) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const event = JSON.parse(raw);
      const tickets = [];

      for (let i = 0; i < event.total_tickets; i++) {
        const ticket_id = `T${String(i + 1).padStart(4, '0')}`;
        const owner = await redis.get(`ticket:${req.params.id}:${ticket_id}:owner`);
        const resales = await redis.get(`ticket:${req.params.id}:${ticket_id}:resales`);
        tickets.push({
          ticket_id,
          owner: owner || 'null',
          resale_count: parseInt(resales || '0'),
        });
      }

      return res.json(tickets);
    } catch (err) {
      console.error('[GET /events/:id/tickets] Error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;

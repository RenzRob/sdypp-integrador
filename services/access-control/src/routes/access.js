'use strict';
require('dotenv').config();
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const redis = require('../lib/redis');

const router = express.Router();

// GET /access/:event_id/:ticket_id
router.get(
  '/:event_id/:ticket_id',
  [
    param('event_id').isUUID().withMessage('Valid event_id required'),
    param('ticket_id').notEmpty().withMessage('ticket_id required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { event_id, ticket_id } = req.params;

    try {
      const owner = await redis.get(`ticket:${event_id}:${ticket_id}:owner`);
      if (owner === null) {
        return res.status(404).json({ error: 'Ticket not found' });
      }

      const resales = await redis.get(`ticket:${event_id}:${ticket_id}:resales`);

      return res.json({
        event_id,
        ticket_id,
        current_owner: owner,
        resale_count: parseInt(resales || '0'),
        is_available: owner === 'null',
      });
    } catch (err) {
      console.error('[GET /access/:event_id/:ticket_id] Error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST /access/validate
router.post(
  '/validate',
  [
    body('event_id').isUUID().withMessage('Valid event_id required'),
    body('ticket_id').notEmpty().withMessage('ticket_id required'),
    body('wallet_address').matches(/^0x[0-9a-f]{8}$/).withMessage('Valid wallet_address required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { event_id, ticket_id, wallet_address } = req.body;

    try {
      const rawEvent = await redis.get(`event:${event_id}`);
      if (!rawEvent) {
        return res.status(404).json({ error: 'Event not found' });
      }
      const event = JSON.parse(rawEvent);

      if (event.status !== 'active') {
        return res.json({ valid: false, message: 'Event is not active', current_owner: null });
      }

      const owner = await redis.get(`ticket:${event_id}:${ticket_id}:owner`);
      if (owner === null) {
        return res.status(404).json({ error: 'Ticket not found' });
      }

      const valid = owner === wallet_address;
      return res.json({
        valid,
        message: valid ? 'Access granted' : 'Access denied: wallet does not match ticket owner',
        current_owner: owner,
      });
    } catch (err) {
      console.error('[POST /access/validate] Error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;

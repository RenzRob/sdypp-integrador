'use strict';
require('dotenv').config();
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const multer = require('multer');
const redis = require('../lib/redis');
const { requireAdmin, requireOptionalAuth } = require('../lib/auth');
const { client: minioClient, BUCKET } = require('../lib/minio');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const MAGIC = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png',  bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/gif',  bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0, extra: { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] } },
];

function detectMimeFromBuffer(buf) {
  for (const sig of MAGIC) {
    const slice = [...buf.slice(sig.offset || 0, (sig.offset || 0) + sig.bytes.length)];
    if (sig.bytes.every((b, i) => b === slice[i])) {
      if (sig.extra) {
        const extra = [...buf.slice(sig.extra.offset, sig.extra.offset + sig.extra.bytes.length)];
        if (!sig.extra.bytes.every((b, i) => b === extra[i])) continue;
      }
      return sig.mime;
    }
  }
  return null;
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

const router = express.Router();

// POST /events/upload-image (admin only)
router.post('/upload-image', requireAdmin, upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file provided' });
  }

  const declaredMime = req.file.mimetype;
  if (!ALLOWED_MIME.includes(declaredMime)) {
    return res.status(400).json({ error: 'File must be an image (jpeg, png, webp, gif)' });
  }

  const detectedMime = detectMimeFromBuffer(req.file.buffer);
  if (!detectedMime) {
    return res.status(400).json({ error: 'File content does not match a valid image format' });
  }

  const ext = EXT[detectedMime];
  const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  const objectName = `${hash}.${ext}`;

  try {
    await minioClient.putObject(BUCKET, objectName, req.file.buffer, req.file.buffer.length, {
      'Content-Type': detectedMime,
    });
    return res.json({ url: `/images/${objectName}` });
  } catch (err) {
    console.error('[upload-image] MinIO error:', err.message);
    return res.status(500).json({ error: 'Failed to store image' });
  }
});

// GET /events
router.get('/', requireOptionalAuth, async (req, res) => {
  const isLoadTestViewer = req.user?.role === 'load_test';

  try {
    const eventIds = await redis.lrange('events:list', 0, -1);
    if (!eventIds || eventIds.length === 0) {
      return res.json([]);
    }

    const events = [];
    for (const id of eventIds) {
      const raw = await redis.get(`event:${id}`);
      if (!raw) continue;

      const ev = JSON.parse(raw);

      if (isLoadTestViewer ? !ev.load_test : ev.load_test) continue;

      const { genesis_block_hash, load_test: _lt, ...safeEvent } = ev;

      const available_tickets = parseInt(
        (await redis.get(`event:${id}:available_tickets`)) || '0'
      );

      events.push({ ...safeEvent, available_tickets });
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
    body('load_test').optional().isBoolean().withMessage('load_test must be boolean'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { name, description, date, venue, total_tickets, price, rules, image_url, load_test } = req.body;

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
        image_url: image_url || null,
        load_test: load_test === true || load_test === 'true',
        genesis_block_hash,
        status: 'active',
        created_at: timestamp,
      };

      await redis.set(`event:${event_id}`, JSON.stringify(event));
      await redis.lpush('events:list', event_id);
      await redis.set(`event:${event_id}:available_tickets`, String(total_tickets));

      // Initialize tickets in batches via pipeline to avoid blocking on large counts
      const BATCH_SIZE = 1000;
      for (let batch = 0; batch < total_tickets; batch += BATCH_SIZE) {
        const pipeline = redis.pipeline();
        const end = Math.min(batch + BATCH_SIZE, total_tickets);
        for (let i = batch; i < end; i++) {
          const ticket_id = `T${String(i + 1).padStart(6, '0')}`;
          pipeline.set(`ticket:${event_id}:${ticket_id}:owner`, 'null');
          pipeline.set(`ticket:${event_id}:${ticket_id}:resales`, '0');
          pipeline.rpush(`event:${event_id}:tickets:pool`, ticket_id);
        }
        await pipeline.exec();
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
  requireOptionalAuth,
  [param('id').isUUID().withMessage('Invalid event ID')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const isLoadTestViewer = req.user?.role === 'load_test';

    try {
      const raw = await redis.get(`event:${req.params.id}`);
      if (!raw) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const event = JSON.parse(raw);

      if (isLoadTestViewer ? !event.load_test : event.load_test) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const blockchain_length = await redis.llen(`blockchain:${req.params.id}`);

      const available_tickets = parseInt(
        (await redis.get(`event:${req.params.id}:available_tickets`)) || '0'
      );

      const { genesis_block_hash, load_test: _lt, ...safeEvent } = event;
      return res.json({ ...safeEvent, available_tickets, blockchain_length });
    } catch (err) {
      console.error('[GET /events/:id] Error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// PATCH /events/:id (admin only — creator)
router.patch(
  '/:id',
  requireAdmin,
  [
    param('id').isUUID().withMessage('Invalid event ID'),
    body('date').optional().isISO8601().withMessage('Valid ISO8601 date required'),
    body('status').optional().isIn(['active', 'suspended']).withMessage('status must be active or suspended'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { date, status } = req.body;
    if (!date && !status) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    try {
      const raw = await redis.get(`event:${req.params.id}`);
      if (!raw) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const event = JSON.parse(raw);

      if (event.status === 'completed') {
        return res.status(409).json({ error: 'Cannot modify a completed event' });
      }

      if (event.creator_id !== req.user.id) {
        return res.status(403).json({ error: 'Only the event creator can edit it' });
      }

      if (date) event.date = date;
      if (status) event.status = status;

      await redis.set(`event:${req.params.id}`, JSON.stringify(event));

      const { genesis_block_hash, ...safeEvent } = event;
      return res.json(safeEvent);
    } catch (err) {
      console.error('[PATCH /events/:id] Error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST /events/:id/finalize — finalize and archive an event (admin only — creator)
router.post(
  '/:id/finalize',
  requireAdmin,
  [
    param('id').isUUID().withMessage('Invalid event ID'),
  ],
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

      if (event.creator_id !== req.user.id) {
        return res.status(403).json({ error: 'Only the event creator can finalize it' });
      }

      if (event.status === 'completed') {
        return res.status(409).json({ error: 'Event is already completed' });
      }

      // Archive blockchain to MinIO (cold storage)
      const blocks = await redis.lrange(`blockchain:${req.params.id}`, 0, -1);
      const parsedBlocks = blocks.map((b) => JSON.parse(b));

      const archive = {
        event: { ...event },
        blockchain: parsedBlocks,
        archived_at: new Date().toISOString(),
      };

      const archiveKey = `archives/${req.params.id}/blockchain.json`;
      const archiveBuffer = Buffer.from(JSON.stringify(archive, null, 2));

      try {
        await minioClient.putObject(BUCKET, archiveKey, archiveBuffer, archiveBuffer.length, {
          'Content-Type': 'application/json',
        });
      } catch (err) {
        console.error('[finalize] MinIO archive error:', err.message);
        return res.status(500).json({ error: 'Failed to archive blockchain to cold storage' });
      }

      // Clear active listings and ticket pool
      await redis.del(`event:${req.params.id}:listings`);
      await redis.del(`event:${req.params.id}:tickets:pool`);

      // Set status to completed
      event.status = 'completed';
      event.completed_at = new Date().toISOString();
      await redis.set(`event:${req.params.id}`, JSON.stringify(event));

      const { genesis_block_hash, ...safeEvent } = event;
      return res.json(safeEvent);
    } catch (err) {
      console.error('[POST /events/:id/finalize] Error:', err.message);
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

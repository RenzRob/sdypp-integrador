'use strict';
require('dotenv').config();
const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const redis = require('../lib/redis');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function generateWalletAddress(userId) {
  return '0x' + crypto.createHash('sha256').update(userId).digest('hex').slice(0, 8);
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      wallet_address: user.wallet_address,
    },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
}

// POST /auth/register
router.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('role').optional().isIn(['user', 'admin']).withMessage('Role must be user or admin'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { email, password, role = 'user' } = req.body;

    try {
      const existingId = await redis.get(`user:email:${email}`);
      if (existingId) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      const id = uuidv4();
      const password_hash = await bcrypt.hash(password, 12);
      const wallet_address = generateWalletAddress(id);
      const created_at = new Date().toISOString();

      const user = { id, email, password_hash, role, wallet_address, created_at };

      await redis.set(`user:${id}`, JSON.stringify(user));
      await redis.set(`user:email:${email}`, id);

      const token = signToken(user);

      return res.status(201).json({
        token,
        user: { id, email, role, wallet_address },
      });
    } catch (err) {
      console.error('[register] Error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST /auth/login
router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { email, password } = req.body;

    try {
      const userId = await redis.get(`user:email:${email}`);
      if (!userId) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const raw = await redis.get(`user:${userId}`);
      if (!raw) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const user = JSON.parse(raw);
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = signToken(user);

      return res.json({
        token,
        user: { id: user.id, email: user.email, role: user.role, wallet_address: user.wallet_address },
      });
    } catch (err) {
      console.error('[login] Error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const raw = await redis.get(`user:${req.user.id}`);
    if (!raw) {
      return res.status(404).json({ error: 'User not found' });
    }
    const { password_hash, ...user } = JSON.parse(raw);
    return res.json({ user });
  } catch (err) {
    console.error('[me] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

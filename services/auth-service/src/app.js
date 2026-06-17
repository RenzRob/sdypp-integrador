'use strict';
require('dotenv').config();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3001;
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

app.get('/ping', (req, res) => res.json({ status: 'ok', service: 'auth-service' }));

const authRoutes = require('./routes/auth');
app.use('/auth', authRoutes);

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Unhandled]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => console.log(`auth-service running on ${PORT}`));

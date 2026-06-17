'use strict';
require('dotenv').config();
const express = require('express');
const { connect } = require('./lib/rabbitmq');

const app = express();
const PORT = process.env.PORT || 3003;
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

app.get('/ping', (req, res) => res.json({ status: 'ok', service: 'transaction-api' }));

const transactionsRoutes = require('./routes/transactions');
app.use('/transactions', transactionsRoutes);

app.use((err, req, res, next) => {
  console.error('[Unhandled]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

connect().then(() => {
  app.listen(PORT, () => console.log(`transaction-api running on ${PORT}`));
});

'use strict';
require('dotenv').config();
const express = require('express');
const client = require('prom-client');
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

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

app.use((req, res, next) => {
  res.on('finish', () => {
    const route = (req.baseUrl || '') + (req.route?.path || req.path);
    httpRequestsTotal.inc({ method: req.method, route, status_code: res.statusCode });
  });
  next();
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

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

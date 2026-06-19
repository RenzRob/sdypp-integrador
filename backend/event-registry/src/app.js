'use strict';
require('dotenv').config();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3002;
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

app.get('/ping', (req, res) => res.json({ status: 'ok', service: 'event-registry' }));

const eventsRoutes = require('./routes/events');
app.use('/events', eventsRoutes);

app.use((err, req, res, next) => {
  console.error('[Unhandled]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const { initBucket } = require('./lib/minio');

initBucket()
  .then(() => app.listen(PORT, () => console.log(`event-registry running on ${PORT}`)))
  .catch((err) => {
    console.error('[Startup] MinIO init failed:', err.message);
    process.exit(1);
  });

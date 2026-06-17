'use strict';
require('dotenv').config();
const express = require('express');
const http = require('http');
const Redis = require('ioredis');
const amqp = require('amqplib');

const app = express();
const PORT = process.env.PORT || 3005;
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

const SERVICES = [
  { name: 'auth-service', url: `http://${process.env.AUTH_HOST || 'localhost'}:3001/ping` },
  { name: 'event-registry', url: `http://${process.env.EVENTS_HOST || 'localhost'}:3002/ping` },
  { name: 'transaction-api', url: `http://${process.env.TRANSACTIONS_HOST || 'localhost'}:3003/ping` },
  { name: 'access-control', url: `http://${process.env.ACCESS_HOST || 'localhost'}:3004/ping` },
  { name: 'nct-miner', url: `http://${process.env.NCT_HOST || 'localhost'}:8000/ping` },
];

function pingService(name, url) {
  return new Promise((resolve) => {
    const start = Date.now();
    let urlObj;
    try {
      urlObj = new URL(url);
    } catch (_) {
      return resolve({ name, status: 'error', latency_ms: 0 });
    }

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'GET',
      timeout: 3000,
    };

    const req = http.request(options, (res) => {
      res.resume();
      resolve({ name, status: res.statusCode < 500 ? 'ok' : 'error', latency_ms: Date.now() - start });
    });

    req.on('error', () => resolve({ name, status: 'error', latency_ms: Date.now() - start }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ name, status: 'error', latency_ms: Date.now() - start });
    });

    req.end();
  });
}

async function checkRedis() {
  let redisClient = null;
  try {
    redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
    });
    await redisClient.connect();
    await redisClient.ping();
    await redisClient.quit();
    return { status: 'ok' };
  } catch (err) {
    if (redisClient) {
      try { await redisClient.quit(); } catch (_) {}
    }
    return { status: 'error' };
  }
}

async function checkRabbitMQ() {
  let conn = null;
  try {
    conn = await Promise.race([
      amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    await conn.close();
    return { status: 'ok' };
  } catch (err) {
    if (conn) {
      try { await conn.close(); } catch (_) {}
    }
    return { status: 'error' };
  }
}

app.get('/ping', (req, res) => res.json({ status: 'ok', service: 'status-api' }));

app.get('/status', async (req, res) => {
  try {
    const [servicesResults, redisStatus, rabbitmqStatus] = await Promise.all([
      Promise.all(SERVICES.map((s) => pingService(s.name, s.url))),
      checkRedis(),
      checkRabbitMQ(),
    ]);

    return res.json({
      timestamp: new Date().toISOString(),
      services: servicesResults,
      infrastructure: {
        redis: redisStatus,
        rabbitmq: rabbitmqStatus,
      },
    });
  } catch (err) {
    console.error('[GET /status] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.use((err, req, res, next) => {
  console.error('[Unhandled]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => console.log(`status-api running on ${PORT}`));

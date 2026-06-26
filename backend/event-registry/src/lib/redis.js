'use strict';
require('dotenv').config();
const Redis = require('ioredis');

function createRedisClient() {
  const sentinelHosts = process.env.REDIS_SENTINEL_HOSTS;
  if (sentinelHosts) {
    const sentinels = sentinelHosts.split(',').map(h => {
      const [host, port] = h.trim().split(':');
      return { host, port: parseInt(port) || 26379 };
    });
    return new Redis({ sentinels, name: 'mymaster', maxRetriesPerRequest: 3 });
  }
  return new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  });
}

const redis = createRedisClient();

redis.on('connect', () => console.log('[Redis] Connected'));
redis.on('error', (err) => console.error('[Redis] Error:', err.message));

module.exports = redis;

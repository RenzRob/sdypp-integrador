'use strict';
require('dotenv').config();
const amqp = require('amqplib');

let channel = null;
const EXCHANGE = 'transactions';
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 3000;

async function connect(attempt = 1) {
  try {
    const conn = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
    console.log('[RabbitMQ] Connected');

    conn.on('error', (err) => {
      console.error('[RabbitMQ] Connection error:', err.message);
      channel = null;
    });
    conn.on('close', () => {
      console.warn('[RabbitMQ] Connection closed, reconnecting...');
      channel = null;
      setTimeout(() => connect(), RETRY_DELAY_MS);
    });

    channel = await conn.createChannel();
    await channel.assertExchange(EXCHANGE, 'direct', { durable: true });
    console.log('[RabbitMQ] Exchange ready');
  } catch (err) {
    console.error(`[RabbitMQ] Connection attempt ${attempt} failed: ${err.message}`);
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return connect(attempt + 1);
    }
    console.error('[RabbitMQ] Max retries reached. Transactions will not be published.');
  }
}

async function publishTransaction(tx) {
  if (!channel) {
    console.warn('[RabbitMQ] No channel, skipping publish for tx:', tx.tx_id);
    return;
  }
  try {
    channel.publish(EXCHANGE, 'tx.new', Buffer.from(JSON.stringify(tx)), { persistent: true });
  } catch (err) {
    console.error('[RabbitMQ] Publish error:', err.message);
  }
}

module.exports = { connect, publishTransaction };

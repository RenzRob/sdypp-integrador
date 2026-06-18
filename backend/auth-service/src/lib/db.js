'use strict';
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (err) => console.error('[DB] Unexpected error:', err.message));

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id           UUID        PRIMARY KEY,
      email        VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role         VARCHAR(50) NOT NULL DEFAULT 'user',
      wallet_address VARCHAR(20),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('[DB] Schema ready');
}

module.exports = { pool, initSchema };

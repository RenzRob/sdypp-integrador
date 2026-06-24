'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

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
  await seedAdmin();
}

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn('[DB] ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin seed');
    return;
  }
  const password_hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (id, email, password_hash, role, wallet_address)
     VALUES (gen_random_uuid(), $2, $1, 'admin', NULL)
     ON CONFLICT (email) DO NOTHING`,
    [password_hash, email]
  );
  console.log('[DB] Admin user ready');
}

module.exports = { pool, initSchema };

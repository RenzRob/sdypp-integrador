/**
 * stress-test.js — TicketChain Stress Test
 *
 * Objetivo: 5.000 RPM de operaciones de compra constantes durante 30 minutos.
 *
 * Estrategia de carga:
 *   - 70% de iteraciones: buy → cancel  (el ticket vuelve al pool → recicla)
 *   - 30% de iteraciones: buy → confirm (transacción real → RabbitMQ → NCT → blockchain)
 *
 * Prerequisitos:
 *   1. k6 instalado (brew install k6)
 *   2. test-data.json generado con setup.py
 *
 * Uso básico:
 *   k6 run stress-test.js
 *
 * Con salida JSON para análisis posterior:
 *   k6 run --out json=results/run.json stress-test.js
 *
 * Con reporte en tiempo real hacia Grafana Cloud (opcional):
 *   k6 run --out experimental-prometheus-rw=http://localhost:9090/api/v1/write stress-test.js
 *
 * Ajustar carga (sin cambiar el archivo):
 *   k6 run -e RATE=2500 -e DURATION=10m stress-test.js
 */

import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Rate, Trend } from 'k6/metrics';
import { randomItem } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// ─── Métricas custom ─────────────────────────────────────────────────────────

const buyOkRate      = new Rate('tc_buy_ok_rate');
const confirmOkRate  = new Rate('tc_confirm_ok_rate');
const cancelOkRate   = new Rate('tc_cancel_ok_rate');

const buyLatency     = new Trend('tc_buy_latency_ms', true);
const confirmLatency = new Trend('tc_confirm_latency_ms', true);
const cancelLatency  = new Trend('tc_cancel_latency_ms', true);

const confirmedTxs    = new Counter('tc_confirmed_txs');
const cancelledTxs    = new Counter('tc_cancelled_txs');
const ticketsExhausted = new Counter('tc_tickets_exhausted');
const authErrors      = new Counter('tc_auth_errors');

// ─── Test data (generado por setup.py) ───────────────────────────────────────
// test-data.json contiene:
//   base_url   — URL base del cluster
//   token      — JWT del usuario de carga (seeded via LOAD_TEST_EMAIL/PASSWORD)
//   events     — array de event_ids creados por setup.py

const _data = new SharedArray('data', () => [JSON.parse(open('./test-data.json'))]);

const baseUrl  = _data[0].base_url;
const TOKEN    = _data[0].token;       // JWT único del usuario de carga

const eventIds = new SharedArray('events', () =>
  JSON.parse(open('./test-data.json')).events
);

// ─── Parámetros (sobreescribibles con -e) ────────────────────────────────────

const RATE_PER_MIN  = parseInt(__ENV.RATE     || '5000');  // iteraciones/minuto
const DURATION      = __ENV.DURATION          || '30m';
const CONFIRM_RATIO = parseFloat(__ENV.CONFIRM || '0.30'); // 30% van a blockchain

// ─── Configuración del escenario ─────────────────────────────────────────────

export const options = {
  scenarios: {
    stress: {
      executor:        'constant-arrival-rate',
      rate:            RATE_PER_MIN,   // 5.000 buy-requests / minuto
      timeUnit:        '1m',
      duration:        DURATION,
      preAllocatedVUs: 300,
      maxVUs:          700,
    },
  },

  thresholds: {
    // Al menos 95% de los buy deben resolverse OK
    tc_buy_ok_rate:     ['rate>=0.95'],
    // P95 de latencia del buy < 2 s
    tc_buy_latency_ms:  ['p(95)<2000'],
    // P95 del confirm < 3 s (tiene más trabajo: Redis + RabbitMQ + NCT)
    tc_confirm_latency_ms: ['p(95)<3000'],
    // Menos del 5% de requests HTTP fallan (excluye 409 de tickets agotados)
    http_req_failed:    ['rate<0.05'],
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function authHeaders(token) {
  return {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${token}`,
  };
}

function safeJson(res) {
  try { return res.json(); } catch { return {}; }
}

// ─── Escenario principal ──────────────────────────────────────────────────────

export default function () {
  const eventId = randomItem(eventIds);
  const hdrs    = authHeaders(TOKEN);

  // ── Step 1: Buy ─────────────────────────────────────────────────────────────
  const tBuy = Date.now();
  const buyRes = http.post(
    `${baseUrl}/api/transactions/buy`,
    JSON.stringify({ event_id: eventId }),
    { headers: hdrs, tags: { endpoint: 'buy' } }
  );
  buyLatency.add(Date.now() - tBuy);

  // Token expirado / inválido (no debería pasar en 30 min, los JWTs duran 24 h)
  if (buyRes.status === 401 || buyRes.status === 403) {
    authErrors.add(1);
    return;
  }

  // Sin tickets disponibles → el evento se agotó; saltamos esta iteración
  if (buyRes.status === 409) {
    ticketsExhausted.add(1);
    return;
  }

  const buyOk = check(buyRes, {
    'buy → 200':          (r) => r.status === 200,
    'buy → tiene tx_id':  (r) => {
      try { return !!r.json('tx_id'); } catch { return false; }
    },
  });
  buyOkRate.add(buyOk);
  if (!buyOk) return;

  const { tx_id } = safeJson(buyRes);
  if (!tx_id) return;

  // ── Step 2: Confirm (30%) o Cancel (70%) ────────────────────────────────────

  if (Math.random() < CONFIRM_RATIO) {
    // ── CONFIRM ─────────────────────────────────────────────────────────────
    // La transacción entra a Redis → RabbitMQ → NCT → minero → blockchain
    const tConf = Date.now();
    const confRes = http.post(
      `${baseUrl}/api/transactions/checkout/confirm`,
      JSON.stringify({ tx_id }),
      { headers: hdrs, tags: { endpoint: 'confirm' } }
    );
    confirmLatency.add(Date.now() - tConf);

    const confOk = check(confRes, {
      'confirm → 200': (r) => r.status === 200,
    });
    confirmOkRate.add(confOk);
    if (confOk) confirmedTxs.add(1);

  } else {
    // ── CANCEL ──────────────────────────────────────────────────────────────
    // El ticket vuelve al pool → se puede volver a comprar (recicla el inventario)
    const tCan = Date.now();
    const canRes = http.del(
      `${baseUrl}/api/transactions/checkout/${tx_id}`,
      null,
      { headers: hdrs, tags: { endpoint: 'cancel' } }
    );
    cancelLatency.add(Date.now() - tCan);

    const canOk = check(canRes, {
      'cancel → 200': (r) => r.status === 200,
    });
    cancelOkRate.add(canOk);
    if (canOk) cancelledTxs.add(1);
  }
}

// ─── Resumen final ───────────────────────────────────────────────────────────

export function handleSummary(data) {
  const m = data.metrics;

  const totalReqs   = m.http_reqs?.values?.count         ?? 0;
  const failedReqs  = m.http_req_failed?.values?.passes  ?? 0;
  const durationMs  = data.state?.testRunDurationMs      ?? 1;

  const rpm          = (totalReqs / (durationMs / 60000)).toFixed(0);
  const buyOkPct     = ((m.tc_buy_ok_rate?.values?.rate     ?? 0) * 100).toFixed(1);
  const confOkPct    = ((m.tc_confirm_ok_rate?.values?.rate ?? 0) * 100).toFixed(1);
  const canOkPct     = ((m.tc_cancel_ok_rate?.values?.rate  ?? 0) * 100).toFixed(1);

  const buyP50  = (m.tc_buy_latency_ms?.values?.['p(50)']  ?? 0).toFixed(0);
  const buyP95  = (m.tc_buy_latency_ms?.values?.['p(95)']  ?? 0).toFixed(0);
  const buyP99  = (m.tc_buy_latency_ms?.values?.['p(99)']  ?? 0).toFixed(0);
  const confP95 = (m.tc_confirm_latency_ms?.values?.['p(95)'] ?? 0).toFixed(0);
  const canP95  = (m.tc_cancel_latency_ms?.values?.['p(95)']  ?? 0).toFixed(0);

  const confirmed  = m.tc_confirmed_txs?.values?.count    ?? 0;
  const cancelled  = m.tc_cancelled_txs?.values?.count    ?? 0;
  const exhausted  = m.tc_tickets_exhausted?.values?.count ?? 0;
  const authErrs   = m.tc_auth_errors?.values?.count      ?? 0;

  const allOk = Object.entries(data.metrics)
    .filter(([, v]) => v.thresholds)
    .every(([, v]) => Object.values(v.thresholds).every(t => t.ok));

  function row(label, value) {
    return `║  ${label.padEnd(22)}${String(value).padEnd(35)}║`;
  }
  function sep() { return '╠══════════════════════════════════════════════════════════════╣'; }
  function blank() { return '║                                                              ║'; }

  const lines = [
    '',
    '╔══════════════════════════════════════════════════════════════╗',
    '║          TICKETCHAIN — STRESS TEST RESULTS                   ║',
    sep(),
    row('Duración total',   `${(durationMs/1000).toFixed(0)}s (${(durationMs/60000).toFixed(1)} min)`),
    row('Total HTTP reqs',  `${totalReqs.toLocaleString()}`),
    row('RPM promedio',     `${rpm} req/min`),
    row('Reqs fallidos',    `${failedReqs}`),
    sep(),
    '║  TASAS DE ÉXITO                                              ║',
    row('Buy success',      `${buyOkPct}%`),
    row('Confirm success',  `${confOkPct}%`),
    row('Cancel success',   `${canOkPct}%`),
    blank(),
    row('Txs → blockchain', `${Number(confirmed).toLocaleString()}`),
    row('Txs canceladas',   `${Number(cancelled).toLocaleString()} (ticket reciclado)`),
    row('Tickets agotados', `${exhausted} (409 ignorados OK)`),
    row('Errores auth',     `${authErrs}`),
    sep(),
    '║  LATENCIAS                                                   ║',
    row('/buy       p50',   `${buyP50} ms`),
    row('/buy       p95',   `${buyP95} ms`),
    row('/buy       p99',   `${buyP99} ms`),
    row('/confirm   p95',   `${confP95} ms`),
    row('/cancel    p95',   `${canP95} ms`),
    sep(),
    `║  THRESHOLDS: ${allOk ? '✅ TODOS PASARON' : '❌ ALGUNO FALLÓ — ver detalle arriba'}`.padEnd(63) + '║',
    '╚══════════════════════════════════════════════════════════════╝',
    '',
  ];

  return {
    stdout: lines.join('\n'),
    'results/summary.json': JSON.stringify(data, null, 2),
  };
}

'use strict';
require('dotenv').config();
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const redis = require('../lib/redis');

const router = express.Router();

// GET /access/:event_id/:ticket_id — consulta de estado (sin autenticación, solo lectura)
router.get(
  '/:event_id/:ticket_id',
  [
    param('event_id').isUUID().withMessage('Valid event_id required'),
    param('ticket_id').notEmpty().withMessage('ticket_id required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { event_id, ticket_id } = req.params;

    try {
      const owner = await redis.get(`ticket:${event_id}:${ticket_id}:owner`);
      if (owner === null) {
        return res.status(404).json({ error: 'Ticket not found' });
      }

      const resales = await redis.get(`ticket:${event_id}:${ticket_id}:resales`);
      const checkedIn = await redis.get(`ticket:${event_id}:${ticket_id}:checked_in`);

      return res.json({
        event_id,
        ticket_id,
        current_owner: owner,
        resale_count: parseInt(resales || '0'),
        checked_in: !!checkedIn,
        checked_in_at: checkedIn || null,
      });
    } catch (err) {
      console.error('[GET /access/:event_id/:ticket_id] Error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST /access/scan — valida el JWT del QR y registra el ingreso
router.post(
  '/scan',
  [body('token').notEmpty().withMessage('token required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ valid: false, message: errors.array()[0].msg });
    }

    const { token } = req.body;

    // Decodificar sin verificar para extraer event_id y ticket_id
    let decoded;
    try {
      decoded = jwt.decode(token);
    } catch {
      return res.status(400).json({ valid: false, message: 'Token malformado' });
    }

    if (!decoded?.event_id || !decoded?.ticket_id || !decoded?.wallet) {
      return res.status(400).json({ valid: false, message: 'Token inválido: faltan campos' });
    }

    const { event_id, ticket_id, wallet } = decoded;

    try {
      // Obtener el secreto del ticket para verificar firma
      const secret = await redis.get(`ticket:${event_id}:${ticket_id}:qr_secret`);
      if (!secret) {
        return res.json({ valid: false, message: 'QR no reconocido para este ticket' });
      }

      // Verificar firma y expiración del JWT
      try {
        jwt.verify(token, secret);
      } catch (err) {
        const msg = err.name === 'TokenExpiredError' ? 'QR expirado, pedile uno nuevo al titular' : 'Firma del QR inválida';
        return res.json({ valid: false, message: msg });
      }

      // Verificar que el evento existe y está activo
      const rawEvent = await redis.get(`event:${event_id}`);
      if (!rawEvent) {
        return res.json({ valid: false, message: 'Evento no encontrado' });
      }
      const event = JSON.parse(rawEvent);
      if (event.status !== 'active') {
        return res.json({ valid: false, message: 'El evento no está activo' });
      }

      // Verificar que el wallet del token sigue siendo el dueño actual
      const currentOwner = await redis.get(`ticket:${event_id}:${ticket_id}:owner`);
      if (currentOwner !== wallet) {
        return res.json({ valid: false, message: 'Este ticket ya no pertenece al titular del QR' });
      }

      // Verificar que no se haya usado ya (anti-replay)
      const alreadyUsed = await redis.get(`ticket:${event_id}:${ticket_id}:checked_in`);
      if (alreadyUsed) {
        return res.json({
          valid: false,
          message: `Ticket ya ingresó al evento (${alreadyUsed})`,
          checked_in_at: alreadyUsed,
        });
      }

      // Registrar ingreso
      const now = new Date().toISOString();
      await redis.set(`ticket:${event_id}:${ticket_id}:checked_in`, now);

      return res.json({
        valid: true,
        message: 'Acceso concedido',
        ticket_id,
        event_name: event.name,
        wallet,
        checked_in_at: now,
      });
    } catch (err) {
      console.error('[POST /access/scan] Error:', err.message);
      return res.status(500).json({ valid: false, message: 'Error interno' });
    }
  }
);

module.exports = router;

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

    // Decodificar sin verificar solo para obtener event_id/ticket_id y buscar el secreto
    let payload;
    try {
      payload = jwt.decode(token);
    } catch {
      return res.status(400).json({ valid: false, message: 'Token inválido' });
    }

    if (!payload?.event_id || !payload?.ticket_id || !payload?.wallet) {
      return res.status(400).json({ valid: false, message: 'Token inválido: faltan campos' });
    }

    const { event_id, ticket_id, wallet } = payload;

    try {
      // Buscar el secreto del ticket para verificar la firma
      const secret = await redis.get(`ticket:${event_id}:${ticket_id}:qr_secret`);
      if (!secret) {
        return res.json({ valid: false, message: 'QR no reconocido' });
      }

      // Verificar firma INMEDIATAMENTE (protege contra tokens forjados)
      let verified;
      try {
        verified = jwt.verify(token, secret);
      } catch (err) {
        const msg = err.name === 'TokenExpiredError' ? 'QR expirado' : 'Firma del QR inválida';
        return res.json({ valid: false, message: msg });
      }

      // A partir de acá el token está VERIFICADO — usar datos del verified, no del decode
      // Verificar que el evento existe y está activo
      const rawEvent = await redis.get(`event:${verified.event_id}`);
      if (!rawEvent) {
        return res.json({ valid: false, message: 'Evento no encontrado' });
      }
      const event = JSON.parse(rawEvent);
      if (event.status !== 'active') {
        return res.json({ valid: false, message: 'El evento no está activo' });
      }

      // Verificar que el wallet del token sigue siendo el dueño actual
      const currentOwner = await redis.get(`ticket:${verified.event_id}:${verified.ticket_id}:owner`);
      if (currentOwner !== verified.wallet) {
        return res.json({ valid: false, message: 'Este ticket ya no pertenece al titular del QR' });
      }

      // Verificar que no se haya usado ya (anti-replay)
      const alreadyUsed = await redis.get(`ticket:${verified.event_id}:${verified.ticket_id}:checked_in`);
      if (alreadyUsed) {
        return res.json({
          valid: false,
          message: `Ticket ya ingresó al evento (${alreadyUsed})`,
          checked_in_at: alreadyUsed,
        });
      }

      // Registrar ingreso
      const now = new Date().toISOString();
      await redis.set(`ticket:${verified.event_id}:${verified.ticket_id}:checked_in`, now);

      return res.json({
        valid: true,
        message: 'Acceso concedido',
        ticket_id: verified.ticket_id,
        event_name: event.name,
        wallet: verified.wallet,
        checked_in_at: now,
      });
    } catch (err) {
      console.error('[POST /access/scan] Error:', err.message);
      return res.status(500).json({ valid: false, message: 'Error interno' });
    }
  }
);

module.exports = router;

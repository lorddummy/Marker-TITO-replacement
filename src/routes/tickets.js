const crypto  = require('crypto');
const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const QRCode   = require('qrcode');

const { getDb } = require('../db/db');
const { generateToken, generateShortCode } = require('../utils/token');
const { logAuditEvent, getAuditTrail }     = require('../utils/audit');
const { requireRole }                       = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// ── helpers ──────────────────────────────────────────────────────────────────

function now() { return new Date().toISOString(); }

function ticketExpiry() {
  const ttl = parseInt(process.env.TICKET_TTL_SECONDS || '0', 10);
  if (!ttl) return null;
  return new Date(Date.now() + ttl * 1000).toISOString();
}

function isExpired(ticket) {
  if (!ticket.expires_at) return false;
  return new Date(ticket.expires_at) < new Date();
}

function formatTicket(row) {
  return {
    ticket_id:           row.ticket_id,
    short_code:          row.short_code,
    value_cents:         row.value_cents,
    currency:            row.currency,
    property_id:         row.property_id,
    machine_id:          row.machine_id   ?? undefined,
    status:              row.status,
    issued_at:           row.issued_at,
    expires_at:          row.expires_at   ?? undefined,
    redeemed_at:         row.redeemed_at  ?? undefined,
    redemption_point_id: row.redemption_point_id ?? undefined,
    voided_at:           row.voided_at    ?? undefined,
    void_reason:         row.void_reason  ?? undefined,
    metadata:            row.metadata ? JSON.parse(row.metadata) : {},
  };
}

function allowedProperties() {
  return (process.env.ALLOWED_PROPERTY_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
}

function validatePropertyId(property_id, res) {
  if (!property_id || typeof property_id !== 'string') {
    res.status(400).json({ error: 'property_id is required.' });
    return false;
  }
  const allowed = allowedProperties();
  if (allowed.length > 0 && !allowed.includes(property_id)) {
    res.status(400).json({ error: `Unknown property_id: ${property_id}` });
    return false;
  }
  return true;
}

/**
 * Validate an ISO 4217 currency code (3 uppercase letters).
 */
function isValidCurrency(code) {
  return typeof code === 'string' && /^[A-Z]{3}$/.test(code);
}

/**
 * Look up a ticket by token OR short_code.
 * Returns null if not found.
 */
function findTicket(db, { token, short_code }) {
  if (token) {
    return db.prepare('SELECT * FROM tickets WHERE token = ?').get(token);
  }
  if (short_code) {
    const code = short_code.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    return db.prepare('SELECT * FROM tickets WHERE short_code = ?').get(code);
  }
  return null;
}

// ── GET /tickets ──────────────────────────────────────────────────────────────
// List tickets with optional filters and cursor-based pagination.

router.get('/', requireRole('operator', 'admin'), (req, res) => {
  const {
    property_id,
    status,
    machine_id,
    issued_after,
    issued_before,
    limit:   limitRaw  = '50',
    cursor,
  } = req.query;

  const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 50, 1), 200);

  const conditions = [];
  const params = [];

  if (property_id) { conditions.push('t.property_id = ?'); params.push(property_id); }
  if (status)      { conditions.push('t.status = ?');      params.push(status); }
  if (machine_id)  { conditions.push('t.machine_id = ?');  params.push(machine_id); }
  if (issued_after)  { conditions.push('t.issued_at >= ?'); params.push(issued_after); }
  if (issued_before) { conditions.push('t.issued_at <= ?'); params.push(issued_before); }

  if (cursor) {
    const cursorTicket = getDb().prepare('SELECT issued_at FROM tickets WHERE ticket_id = ?').get(cursor);
    if (cursorTicket) {
      conditions.push('t.issued_at < ?');
      params.push(cursorTicket.issued_at);
    }
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const db = getDb();

  const rows = db.prepare(`
    SELECT t.* FROM tickets t
    ${where}
    ORDER BY t.issued_at DESC
    LIMIT ?
  `).all(...params, limit + 1);

  const hasMore = rows.length > limit;
  const items   = hasMore ? rows.slice(0, limit) : rows;

  return res.status(200).json({
    items:       items.map(formatTicket),
    has_more:    hasMore,
    next_cursor: hasMore ? items[items.length - 1].ticket_id : null,
    count:       items.length,
  });
});

// ── GET /tickets/by-shortcode/:code ──────────────────────────────────────────
// Look up a ticket by its human-readable short code.

router.get('/by-shortcode/:code', requireRole('operator', 'cage', 'admin'), (req, res) => {
  const code = req.params.code.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const db = getDb();
  const ticket = db.prepare('SELECT * FROM tickets WHERE short_code = ?').get(code);

  if (!ticket) return res.status(404).json({ error: 'No ticket found for that short code.' });

  return res.status(200).json(formatTicket(ticket));
});

// ── POST /tickets ─────────────────────────────────────────────────────────────
// Issue a new digital ticket.
// Supports Idempotency-Key header: safe to retry on network failure.

router.post('/', requireRole('operator', 'admin'), (req, res) => {
  const {
    value_cents,
    property_id,
    machine_id,
    currency = 'USD',
    metadata = {},
  } = req.body;

  if (!Number.isInteger(value_cents) || value_cents <= 0) {
    return res.status(400).json({ error: 'value_cents must be a positive integer.' });
  }
  const maxValue = parseInt(process.env.MAX_TICKET_VALUE_CENTS || '10000000', 10);
  if (value_cents > maxValue) {
    return res.status(400).json({ error: `value_cents exceeds maximum allowed (${maxValue}).` });
  }
  if (!validatePropertyId(property_id, res)) return;
  if (!isValidCurrency(currency)) {
    return res.status(400).json({ error: 'currency must be a 3-letter ISO 4217 code (e.g. USD, EUR).' });
  }
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    return res.status(400).json({ error: 'metadata must be a JSON object.' });
  }
  if (JSON.stringify(metadata).length > 4096) {
    return res.status(400).json({ error: 'metadata exceeds 4 KB limit.' });
  }

  const idempotencyKey = req.headers['idempotency-key'];
  const db = getDb();

  if (idempotencyKey) {
    const existing = db.prepare(`
      SELECT t.* FROM tickets t
      JOIN idempotency_keys ik ON ik.ticket_id = t.ticket_id
      WHERE ik.idem_key = ? AND ik.property_id = ?
    `).get(idempotencyKey, property_id);

    if (existing) {
      logger.info('Idempotent re-issue — returning existing ticket', {
        ticket_id: existing.ticket_id,
        idem_key:  idempotencyKey,
      });
      res.setHeader('Idempotency-Replayed', 'true');
      return res.status(200).json({
        ticket_id:   existing.ticket_id,
        token:       existing.token,
        short_code:  existing.short_code,
        value_cents: existing.value_cents,
        currency:    existing.currency,
        issued_at:   existing.issued_at,
        expires_at:  existing.expires_at ?? undefined,
      });
    }
  }

  const ticket_id  = uuidv4();
  const token      = generateToken();
  const short_code = generateShortCode();
  const issued_at  = now();
  const expires_at = ticketExpiry();

  db.transaction(() => {
    db.prepare(`
      INSERT INTO tickets
        (ticket_id, token, short_code, value_cents, currency, property_id, machine_id, status, issued_at, expires_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?)
    `).run(
      ticket_id, token, short_code, value_cents, currency,
      property_id, machine_id ?? null,
      issued_at, expires_at,
      JSON.stringify(metadata)
    );

    if (idempotencyKey) {
      db.prepare(`
        INSERT INTO idempotency_keys (idem_key, property_id, ticket_id, created_at)
        VALUES (?, ?, ?, ?)
      `).run(idempotencyKey, property_id, ticket_id, issued_at);
    }

    logAuditEvent(ticket_id, 'issued', {
      actorId:    machine_id,
      propertyId: property_id,
      detail:     { value_cents, currency, machine_id },
    });
  })();

  logger.info('Ticket issued', { ticket_id, value_cents, currency, property_id, short_code });

  return res.status(201).json({
    ticket_id,
    token,
    short_code,
    value_cents,
    currency,
    issued_at,
    expires_at: expires_at ?? undefined,
  });
});

// ── POST /tickets/batch ───────────────────────────────────────────────────────
// Issue multiple tickets in a single atomic transaction.
// Max 20 tickets per batch.

router.post('/batch', requireRole('operator', 'admin'), (req, res) => {
  const { tickets: items, property_id } = req.body;

  if (!validatePropertyId(property_id, res)) return;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'tickets must be a non-empty array.' });
  }
  if (items.length > 20) {
    return res.status(400).json({ error: 'Maximum 20 tickets per batch.' });
  }

  const maxValue = parseInt(process.env.MAX_TICKET_VALUE_CENTS || '10000000', 10);

  for (const [i, item] of items.entries()) {
    if (!Number.isInteger(item.value_cents) || item.value_cents <= 0) {
      return res.status(400).json({ error: `tickets[${i}].value_cents must be a positive integer.` });
    }
    if (item.value_cents > maxValue) {
      return res.status(400).json({ error: `tickets[${i}].value_cents exceeds maximum (${maxValue}).` });
    }
    const itemCurrency = item.currency || 'USD';
    if (!isValidCurrency(itemCurrency)) {
      return res.status(400).json({ error: `tickets[${i}].currency must be a 3-letter ISO 4217 code.` });
    }
  }

  const db = getDb();
  const issued_at  = now();
  const expires_at = ticketExpiry();
  const issued     = [];

  db.transaction(() => {
    const insertTicket = db.prepare(`
      INSERT INTO tickets
        (ticket_id, token, short_code, value_cents, currency, property_id, machine_id, status, issued_at, expires_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?)
    `);

    for (const item of items) {
      const ticket_id  = uuidv4();
      const token      = generateToken();
      const short_code = generateShortCode();
      const currency   = item.currency || 'USD';
      const meta       = item.metadata || {};

      insertTicket.run(
        ticket_id, token, short_code, item.value_cents, currency,
        property_id, item.machine_id ?? null,
        issued_at, expires_at,
        JSON.stringify(meta)
      );

      logAuditEvent(ticket_id, 'issued', {
        actorId:    item.machine_id,
        propertyId: property_id,
        detail:     { value_cents: item.value_cents, currency, batch: true },
      });

      issued.push({
        ticket_id, token, short_code,
        value_cents: item.value_cents,
        currency,
        issued_at,
        expires_at: expires_at ?? undefined,
      });
    }
  })();

  logger.info('Batch issued', { count: issued.length, property_id });

  return res.status(201).json({ issued, count: issued.length });
});

// ── POST /tickets/validate ────────────────────────────────────────────────────
// Check validity without redeeming.
// Accepts token OR short_code for lookup.
// cage + admin only (validate is a precursor to redemption).

router.post('/validate', requireRole('cage', 'admin'), (req, res) => {
  const { token, short_code, property_id, audit = false } = req.body;

  if (!token && !short_code) {
    return res.status(400).json({ error: 'Provide token or short_code.' });
  }

  const db     = getDb();
  const ticket = findTicket(db, { token, short_code });

  if (!ticket) {
    return res.status(200).json({ valid: false, reason: 'Ticket not found.' });
  }

  if (property_id && ticket.property_id !== property_id) {
    return res.status(200).json({ valid: false, reason: 'Ticket is not valid for this property.' });
  }

  if (isExpired(ticket) && ticket.status === 'issued') {
    db.transaction(() => {
      db.prepare(`UPDATE tickets SET status = 'expired' WHERE ticket_id = ?`).run(ticket.ticket_id);
      logAuditEvent(ticket.ticket_id, 'expired', { propertyId: property_id });
    })();
    return res.status(200).json({ valid: false, reason: 'Ticket has expired.' });
  }

  if (ticket.status !== 'issued') {
    return res.status(200).json({
      valid:       false,
      reason:      `Ticket is ${ticket.status}.`,
      status:      ticket.status,
      redeemed_at: ticket.redeemed_at ?? undefined,
    });
  }

  if (audit) {
    logAuditEvent(ticket.ticket_id, 'validated', {
      propertyId: property_id,
      detail:     { requested_by: property_id },
    });
  }

  logger.info('Ticket validated', { ticket_id: ticket.ticket_id, property_id });

  return res.status(200).json({
    valid:        true,
    ticket_id:    ticket.ticket_id,
    short_code:   ticket.short_code,
    value_cents:  ticket.value_cents,
    currency:     ticket.currency,
    property_id:  ticket.property_id,
    expires_at:   ticket.expires_at ?? undefined,
  });
});

// ── POST /tickets/redeem ──────────────────────────────────────────────────────
// Atomically validate and redeem — one-time, no double-spend.
// Accepts token OR short_code for lookup.
// cage + admin only — EGM operators issue, cage staff redeem.

router.post('/redeem', requireRole('cage', 'admin'), (req, res) => {
  const { token, short_code, property_id, redemption_point_id } = req.body;

  if (!token && !short_code) {
    return res.status(400).json({ error: 'Provide token or short_code.' });
  }
  if (!property_id) return res.status(400).json({ error: 'property_id is required.' });

  const db = getDb();
  let result;

  db.transaction(() => {
    const ticket = findTicket(db, { token, short_code });

    if (!ticket) {
      result = { success: false, status: 404, reason: 'Ticket not found.' };
      return;
    }
    if (ticket.property_id !== property_id) {
      result = { success: false, status: 409, reason: 'Ticket is not valid for this property.' };
      return;
    }
    if (isExpired(ticket) && ticket.status === 'issued') {
      db.prepare(`UPDATE tickets SET status = 'expired' WHERE ticket_id = ?`).run(ticket.ticket_id);
      logAuditEvent(ticket.ticket_id, 'expired', { propertyId: property_id });
      result = { success: false, status: 409, reason: 'Ticket has expired.' };
      return;
    }
    if (ticket.status !== 'issued') {
      result = {
        success:       false,
        status:        409,
        reason:        `Ticket is already ${ticket.status}.`,
        ticket_status: ticket.status,
        redeemed_at:   ticket.redeemed_at ?? undefined,
      };
      return;
    }

    const redeemed_at = now();
    db.prepare(`
      UPDATE tickets
      SET status = 'redeemed', redeemed_at = ?, redemption_point_id = ?
      WHERE ticket_id = ?
    `).run(redeemed_at, redemption_point_id ?? null, ticket.ticket_id);

    logAuditEvent(ticket.ticket_id, 'redeemed', {
      actorId:    redemption_point_id,
      propertyId: property_id,
      detail:     { redemption_point_id, value_cents: ticket.value_cents },
    });

    result = {
      success:             true,
      ticket_id:           ticket.ticket_id,
      value_cents:         ticket.value_cents,
      currency:            ticket.currency,
      redeemed_at,
      redemption_point_id: redemption_point_id ?? undefined,
    };
  })();

  if (result.success) {
    logger.info('Ticket redeemed', {
      ticket_id:   result.ticket_id,
      value_cents: result.value_cents,
      property_id,
    });
    return res.status(200).json(result);
  } else {
    logger.warn('Ticket redemption failed', { reason: result.reason });
    const httpStatus = result.status || 409;
    const { status: _s, ...body } = result;
    return res.status(httpStatus).json(body);
  }
});

// ── GET /tickets/:id ──────────────────────────────────────────────────────────
// Admin/audit: get full ticket state.

router.get('/:id', requireRole('operator', 'cage', 'admin'), (req, res) => {
  const db = getDb();
  const ticket = db.prepare('SELECT * FROM tickets WHERE ticket_id = ?').get(req.params.id);

  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

  return res.status(200).json(formatTicket(ticket));
});

// ── GET /tickets/:id/audit ────────────────────────────────────────────────────
// Full audit trail for a ticket. Admin only.

router.get('/:id/audit', requireRole('admin'), (req, res) => {
  const db = getDb();
  const ticket = db.prepare('SELECT ticket_id FROM tickets WHERE ticket_id = ?').get(req.params.id);

  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

  const events = getAuditTrail(req.params.id);
  return res.status(200).json({ ticket_id: req.params.id, events });
});

// ── GET /tickets/:id/qr ───────────────────────────────────────────────────────
// Generate a QR code as a JSON data-URL.

router.get('/:id/qr', requireRole('operator', 'cage', 'admin'), async (req, res) => {
  const db     = getDb();
  const ticket = db.prepare('SELECT * FROM tickets WHERE ticket_id = ?').get(req.params.id);

  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
  if (ticket.status !== 'issued') {
    return res.status(410).json({ error: `Ticket is ${ticket.status} and no longer redeemable.` });
  }

  try {
    const qrDataUrl = await QRCode.toDataURL(ticket.token, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width:  400,
    });
    return res.status(200).json({
      ticket_id:   ticket.ticket_id,
      short_code:  ticket.short_code,
      value_cents: ticket.value_cents,
      currency:    ticket.currency,
      qr_data_url: qrDataUrl,
    });
  } catch (err) {
    logger.error('QR generation failed', { ticket_id: ticket.ticket_id, error: err.message });
    return res.status(500).json({ error: 'Failed to generate QR code.' });
  }
});

// ── GET /tickets/:id/qr.png ───────────────────────────────────────────────────
// Serve the QR code as a raw PNG image (for embedding in HTML, apps, receipts).

router.get('/:id/qr.png', requireRole('operator', 'cage', 'admin'), async (req, res) => {
  const db     = getDb();
  const ticket = db.prepare('SELECT * FROM tickets WHERE ticket_id = ?').get(req.params.id);

  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
  if (ticket.status !== 'issued') {
    return res.status(410).json({ error: `Ticket is ${ticket.status} and no longer redeemable.` });
  }

  try {
    const pngBuffer = await QRCode.toBuffer(ticket.token, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width:  400,
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(pngBuffer);
  } catch (err) {
    logger.error('QR PNG generation failed', { ticket_id: ticket.ticket_id, error: err.message });
    return res.status(500).json({ error: 'Failed to generate QR code.' });
  }
});

// ── POST /tickets/:id/void ────────────────────────────────────────────────────
// Operator: void (cancel) an unspent ticket.

router.post('/:id/void', requireRole('operator', 'admin'), (req, res) => {
  const { reason } = req.body;
  const db     = getDb();
  const ticket = db.prepare('SELECT * FROM tickets WHERE ticket_id = ?').get(req.params.id);

  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
  if (ticket.status !== 'issued') {
    return res.status(409).json({ error: `Cannot void a ticket with status '${ticket.status}'.` });
  }

  const voided_at = now();
  db.transaction(() => {
    db.prepare(`
      UPDATE tickets SET status = 'voided', voided_at = ?, void_reason = ? WHERE ticket_id = ?
    `).run(voided_at, reason ?? null, ticket.ticket_id);

    logAuditEvent(ticket.ticket_id, 'voided', { detail: { reason } });
  })();

  logger.info('Ticket voided', { ticket_id: ticket.ticket_id, reason });

  return res.status(200).json({
    ticket_id: ticket.ticket_id,
    status:    'voided',
    voided_at,
    reason:    reason ?? undefined,
  });
});

// ── POST /tickets/:id/extend ──────────────────────────────────────────────────
// Extend the expiry of an issued ticket.

router.post('/:id/extend', requireRole('operator', 'admin'), (req, res) => {
  const { extend_seconds, new_expires_at } = req.body;
  const db     = getDb();
  const ticket = db.prepare('SELECT * FROM tickets WHERE ticket_id = ?').get(req.params.id);

  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
  if (ticket.status !== 'issued') {
    return res.status(409).json({ error: `Cannot extend a ticket with status '${ticket.status}'.` });
  }

  let newExpiry;
  if (new_expires_at) {
    newExpiry = new Date(new_expires_at).toISOString();
  } else if (Number.isInteger(extend_seconds) && extend_seconds > 0) {
    const base = ticket.expires_at ? new Date(ticket.expires_at) : new Date();
    newExpiry  = new Date(base.getTime() + extend_seconds * 1000).toISOString();
  } else {
    return res.status(400).json({ error: 'Provide extend_seconds (integer) or new_expires_at (ISO-8601).' });
  }

  if (new Date(newExpiry) <= new Date()) {
    return res.status(400).json({ error: 'new_expires_at must be in the future.' });
  }

  const old_expires_at = ticket.expires_at;
  db.transaction(() => {
    db.prepare('UPDATE tickets SET expires_at = ? WHERE ticket_id = ?').run(newExpiry, ticket.ticket_id);
    logAuditEvent(ticket.ticket_id, 'extended', {
      detail: { old_expires_at, new_expires_at: newExpiry },
    });
  })();

  logger.info('Ticket expiry extended', { ticket_id: ticket.ticket_id, new_expires_at: newExpiry });

  return res.status(200).json({
    ticket_id:            ticket.ticket_id,
    expires_at:           newExpiry,
    previous_expires_at:  old_expires_at ?? undefined,
  });
});

module.exports = router;

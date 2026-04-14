const express = require('express');
const { getDb } = require('../db/db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// All report endpoints require admin role.
router.use(requireRole('admin'));

// ── GET /v1/reports/stats ─────────────────────────────────────────────────────
// Aggregate stats across all tickets (optionally filtered by property).

router.get('/stats', (req, res) => {
  const { property_id } = req.query;
  const db = getDb();

  const where = property_id ? 'WHERE property_id = ?' : '';
  const params = property_id ? [property_id] : [];

  const totals = db.prepare(`
    SELECT
      COUNT(*)                                           AS total_tickets,
      SUM(CASE WHEN status = 'issued'   THEN 1 ELSE 0 END) AS issued_count,
      SUM(CASE WHEN status = 'redeemed' THEN 1 ELSE 0 END) AS redeemed_count,
      SUM(CASE WHEN status = 'voided'   THEN 1 ELSE 0 END) AS voided_count,
      SUM(CASE WHEN status = 'expired'  THEN 1 ELSE 0 END) AS expired_count,
      SUM(value_cents)                                   AS total_value_cents,
      SUM(CASE WHEN status = 'issued'   THEN value_cents ELSE 0 END) AS outstanding_value_cents,
      SUM(CASE WHEN status = 'redeemed' THEN value_cents ELSE 0 END) AS redeemed_value_cents,
      SUM(CASE WHEN status = 'voided'   THEN value_cents ELSE 0 END) AS voided_value_cents
    FROM tickets ${where}
  `).get(...params);

  const currencyBreakdown = db.prepare(`
    SELECT
      currency,
      COUNT(*) AS ticket_count,
      SUM(value_cents) AS total_value_cents,
      SUM(CASE WHEN status = 'issued'   THEN value_cents ELSE 0 END) AS outstanding_value_cents,
      SUM(CASE WHEN status = 'redeemed' THEN value_cents ELSE 0 END) AS redeemed_value_cents
    FROM tickets ${where}
    GROUP BY currency
    ORDER BY total_value_cents DESC
  `).all(...params);

  return res.status(200).json({
    property_id:  property_id || null,
    generated_at: new Date().toISOString(),
    totals,
    by_currency:  currencyBreakdown,
  });
});

// ── GET /v1/reports/reconciliation ───────────────────────────────────────────
// Daily reconciliation report: tickets issued vs redeemed for a date and property.

router.get('/reconciliation', (req, res) => {
  const { property_id, date } = req.query;

  if (!property_id) {
    return res.status(400).json({ error: 'property_id is required.' });
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date is required and must be in YYYY-MM-DD format.' });
  }

  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd   = `${date}T23:59:59.999Z`;

  const db = getDb();

  const issued = db.prepare(`
    SELECT
      COUNT(*)         AS count,
      SUM(value_cents) AS total_value_cents,
      currency
    FROM tickets
    WHERE property_id = ? AND issued_at BETWEEN ? AND ?
    GROUP BY currency
  `).all(property_id, dayStart, dayEnd);

  const redeemed = db.prepare(`
    SELECT
      COUNT(*)         AS count,
      SUM(value_cents) AS total_value_cents,
      currency
    FROM tickets
    WHERE property_id = ? AND redeemed_at BETWEEN ? AND ?
    GROUP BY currency
  `).all(property_id, dayStart, dayEnd);

  const voided = db.prepare(`
    SELECT
      COUNT(*)         AS count,
      SUM(value_cents) AS total_value_cents,
      currency
    FROM tickets
    WHERE property_id = ? AND voided_at BETWEEN ? AND ?
    GROUP BY currency
  `).all(property_id, dayStart, dayEnd);

  const outstanding = db.prepare(`
    SELECT
      COUNT(*)         AS count,
      SUM(value_cents) AS total_value_cents,
      currency
    FROM tickets
    WHERE property_id = ? AND status = 'issued' AND issued_at <= ?
    GROUP BY currency
  `).all(property_id, dayEnd);

  // Summary per currency
  const currencies = new Set([
    ...issued.map(r => r.currency),
    ...redeemed.map(r => r.currency),
  ]);

  const summary = [...currencies].map(currency => {
    const i = issued.find(r => r.currency === currency)    || { count: 0, total_value_cents: 0 };
    const r = redeemed.find(r => r.currency === currency)  || { count: 0, total_value_cents: 0 };
    const v = voided.find(r => r.currency === currency)    || { count: 0, total_value_cents: 0 };
    const o = outstanding.find(r => r.currency === currency) || { count: 0, total_value_cents: 0 };
    return {
      currency,
      issued:      { count: i.count, value_cents: i.total_value_cents },
      redeemed:    { count: r.count, value_cents: r.total_value_cents },
      voided:      { count: v.count, value_cents: v.total_value_cents },
      outstanding: { count: o.count, value_cents: o.total_value_cents },
      variance_cents: (i.total_value_cents || 0) - (r.total_value_cents || 0) - (v.total_value_cents || 0),
    };
  });

  return res.status(200).json({
    property_id,
    date,
    generated_at: new Date().toISOString(),
    summary,
  });
});

// ── GET /v1/reports/top-machines ─────────────────────────────────────────────
// Top issuing machines for a property over a date range.

router.get('/top-machines', (req, res) => {
  const { property_id, issued_after, issued_before, limit: limitRaw = '10' } = req.query;
  const limit = Math.min(parseInt(limitRaw, 10) || 10, 50);

  if (!property_id) return res.status(400).json({ error: 'property_id is required.' });

  const conditions = ['property_id = ?', 'machine_id IS NOT NULL'];
  const params = [property_id];

  if (issued_after)  { conditions.push('issued_at >= ?'); params.push(issued_after); }
  if (issued_before) { conditions.push('issued_at <= ?'); params.push(issued_before); }

  const db = getDb();
  const rows = db.prepare(`
    SELECT
      machine_id,
      COUNT(*)                                              AS ticket_count,
      SUM(value_cents)                                      AS total_value_cents,
      SUM(CASE WHEN status = 'redeemed' THEN 1 ELSE 0 END) AS redeemed_count,
      SUM(CASE WHEN status = 'redeemed' THEN value_cents ELSE 0 END) AS redeemed_value_cents
    FROM tickets
    WHERE ${conditions.join(' AND ')}
    GROUP BY machine_id
    ORDER BY total_value_cents DESC
    LIMIT ?
  `).all(...params, limit);

  return res.status(200).json({
    property_id,
    generated_at: new Date().toISOString(),
    machines: rows,
  });
});

module.exports = router;

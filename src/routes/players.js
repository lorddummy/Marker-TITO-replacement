const express = require('express');
const { requireRole } = require('../middleware/auth');
const { getDb } = require('../db/db');

const router = express.Router();

function formatTicket(row) {
  return {
    ticket_id: row.ticket_id,
    short_code: row.short_code,
    value_cents: row.value_cents,
    currency: row.currency,
    property_id: row.property_id,
    machine_id: row.machine_id ?? undefined,
    account_id: row.account_id ?? undefined,
    player_id: row.player_id ?? undefined,
    status: row.status,
    issued_at: row.issued_at,
    expires_at: row.expires_at ?? undefined,
    redeemed_at: row.redeemed_at ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
  };
}

router.get('/:player_id/tickets', requireRole('admin', 'operator', 'cage'), (req, res) => {
  const { property_id: propertyId, status, limit: limitRaw = '50' } = req.query;
  const limit = Math.min(parseInt(limitRaw, 10) || 50, 200);
  const db = getDb();

  let sql = `
    SELECT * FROM tickets
    WHERE (player_id = ? OR account_id = ?)
  `;
  const params = [req.params.player_id, req.params.player_id];

  if (propertyId) { sql += ' AND property_id = ?'; params.push(propertyId); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY issued_at DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(sql).all(...params);
  return res.json({
    player_id: req.params.player_id,
    tickets: rows.map(formatTicket),
    count: rows.length,
  });
});

module.exports = router;

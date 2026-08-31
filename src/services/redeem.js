const { getDb } = require('../db/db');
const { logAuditEvent } = require('../utils/audit');
const logger = require('../utils/logger');

function now() { return new Date().toISOString(); }

function isExpired(ticket) {
  if (!ticket.expires_at) return false;
  return new Date(ticket.expires_at) < new Date();
}

function findTicket(db, { token, short_code: shortCode }) {
  if (token) {
    return db.prepare('SELECT * FROM tickets WHERE token = ?').get(token);
  }
  if (shortCode) {
    const code = shortCode.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    return db.prepare('SELECT * FROM tickets WHERE short_code = ?').get(code);
  }
  return null;
}

function redeemTicket({ token, short_code: shortCode, property_id: propertyId, redemption_point_id: redemptionPointId }) {
  if (!token && !shortCode) {
    const err = new Error('Provide token or short_code.');
    err.status = 400;
    throw err;
  }
  if (!propertyId) {
    const err = new Error('property_id is required.');
    err.status = 400;
    throw err;
  }

  const db = getDb();
  let result;

  db.transaction(() => {
    const ticket = findTicket(db, { token, short_code: shortCode });
    if (!ticket) {
      result = { success: false, httpStatus: 404, reason: 'Ticket not found.' };
      return;
    }
    if (ticket.property_id !== propertyId) {
      result = { success: false, httpStatus: 409, reason: 'Ticket is not valid for this property.' };
      return;
    }
    if (isExpired(ticket) && ticket.status === 'issued') {
      db.prepare(`UPDATE tickets SET status = 'expired' WHERE ticket_id = ?`).run(ticket.ticket_id);
      logAuditEvent(ticket.ticket_id, 'expired', { propertyId });
      result = { success: false, httpStatus: 409, reason: 'Ticket has expired.' };
      return;
    }
    if (ticket.status !== 'issued') {
      result = {
        success: false,
        httpStatus: 409,
        reason: `Ticket is already ${ticket.status}.`,
        ticket_status: ticket.status,
      };
      return;
    }
    const redeemed_at = now();
    db.prepare(`
      UPDATE tickets SET status = 'redeemed', redeemed_at = ?, redemption_point_id = ?
      WHERE ticket_id = ?
    `).run(redeemed_at, redemptionPointId ?? null, ticket.ticket_id);
    logAuditEvent(ticket.ticket_id, 'redeemed', {
      actorId: redemptionPointId,
      propertyId,
      detail: { value_cents: ticket.value_cents },
    });
    result = {
      success: true,
      ticket_id: ticket.ticket_id,
      value_cents: ticket.value_cents,
      currency: ticket.currency,
      account_id: ticket.account_id ?? undefined,
      player_id: ticket.player_id ?? undefined,
      redeemed_at,
      redemption_point_id: redemptionPointId ?? undefined,
    };
  })();

  if (result.success) {
    logger.info('Ticket redeemed', { ticket_id: result.ticket_id, property_id: propertyId });
  }
  return result;
}

module.exports = { redeemTicket, findTicket };

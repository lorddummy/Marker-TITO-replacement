const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/db');
const { generateToken, generateShortCode } = require('../utils/token');
const { logAuditEvent } = require('../utils/audit');
const logger = require('../utils/logger');

function now() { return new Date().toISOString(); }

function ticketExpiry() {
  const ttl = parseInt(process.env.TICKET_TTL_SECONDS || '0', 10);
  if (!ttl) return null;
  return new Date(Date.now() + ttl * 1000).toISOString();
}

function isValidCurrency(code) {
  return typeof code === 'string' && /^[A-Z]{3}$/.test(code);
}

function issueTicket({
  value_cents: valueCents,
  property_id: propertyId,
  machine_id: machineId,
  account_id: accountId,
  player_id: playerId,
  currency = 'USD',
  metadata = {},
  idempotencyKey,
}) {
  if (!Number.isInteger(valueCents) || valueCents <= 0) {
    const err = new Error('value_cents must be a positive integer.');
    err.status = 400;
    throw err;
  }
  if (!propertyId) {
    const err = new Error('property_id is required.');
    err.status = 400;
    throw err;
  }
  if (!isValidCurrency(currency)) {
    const err = new Error('currency must be a 3-letter ISO 4217 code.');
    err.status = 400;
    throw err;
  }

  const db = getDb();
  const resolvedPlayer = playerId || accountId || metadata.player_id || metadata.card_id || null;
  const resolvedAccount = accountId || metadata.account_id || null;

  if (idempotencyKey) {
    const existing = db.prepare(`
      SELECT t.* FROM tickets t
      JOIN idempotency_keys ik ON ik.ticket_id = t.ticket_id
      WHERE ik.idem_key = ? AND ik.property_id = ?
    `).get(idempotencyKey, propertyId);
    if (existing) {
      return {
        replayed: true,
        ticket_id: existing.ticket_id,
        token: existing.token,
        short_code: existing.short_code,
        value_cents: existing.value_cents,
        currency: existing.currency,
        account_id: existing.account_id ?? undefined,
        player_id: existing.player_id ?? undefined,
        issued_at: existing.issued_at,
        expires_at: existing.expires_at ?? undefined,
      };
    }
  }

  const ticket_id = uuidv4();
  const token = generateToken();
  const short_code = generateShortCode();
  const issued_at = now();
  const expires_at = ticketExpiry();
  const meta = { ...metadata };
  if (resolvedAccount) meta.account_id = resolvedAccount;
  if (resolvedPlayer) meta.player_id = resolvedPlayer;

  db.transaction(() => {
    db.prepare(`
      INSERT INTO tickets
        (ticket_id, token, short_code, value_cents, currency, property_id, machine_id,
         account_id, player_id, status, issued_at, expires_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?)
    `).run(
      ticket_id, token, short_code, valueCents, currency,
      propertyId, machineId ?? null,
      resolvedAccount, resolvedPlayer,
      issued_at, expires_at,
      JSON.stringify(meta)
    );
    if (idempotencyKey) {
      db.prepare(`
        INSERT INTO idempotency_keys (idem_key, property_id, ticket_id, created_at)
        VALUES (?, ?, ?, ?)
      `).run(idempotencyKey, propertyId, ticket_id, issued_at);
    }
    logAuditEvent(ticket_id, 'issued', {
      actorId: machineId,
      propertyId,
      detail: { value_cents: valueCents, currency, machine_id: machineId, player_id: resolvedPlayer },
    });
  })();

  logger.info('Ticket issued', { ticket_id, property_id: propertyId, player_id: resolvedPlayer });

  return {
    replayed: false,
    ticket_id,
    token,
    short_code,
    value_cents: valueCents,
    currency,
    account_id: resolvedAccount ?? undefined,
    player_id: resolvedPlayer ?? undefined,
    issued_at,
    expires_at: expires_at ?? undefined,
  };
}

module.exports = { issueTicket };

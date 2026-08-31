/**
 * Ticket API test suite — Node.js built-in test runner (node:test)
 * Run: node --test src/tests/tickets.test.js
 */

process.env.DB_PATH            = ':memory:';
process.env.API_KEYS           = 'test-key';        // admin (backward-compat)
process.env.ADMIN_KEYS         = 'admin-key';
process.env.OPERATOR_KEYS      = 'operator-key';
process.env.CAGE_KEYS          = 'cage-key';
process.env.PORT               = '0';               // let OS pick
process.env.TICKET_TTL_SECONDS = '0';
process.env.LOG_LEVEL          = 'error';           // silence info logs during tests

const { test, before, after, describe } = require('node:test');
const assert  = require('node:assert/strict');
const http    = require('node:http');

// Import app AFTER env is set
const app = require('../index');

let server;
let baseUrl;
const AUTH          = { 'Content-Type': 'application/json', 'X-API-Key': 'test-key' };
const ADMIN_AUTH    = { 'Content-Type': 'application/json', 'X-API-Key': 'admin-key' };
const OPERATOR_AUTH = { 'Content-Type': 'application/json', 'X-API-Key': 'operator-key' };
const CAGE_AUTH     = { 'Content-Type': 'application/json', 'X-API-Key': 'cage-key' };
const NO_AUTH       = { 'Content-Type': 'application/json' };

// ── Test helpers ──────────────────────────────────────────────────────────────

function request(method, path, body, headers = AUTH) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(baseUrl + path, {
      method,
      headers: { ...headers, ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); } catch (_) { json = data; }
        resolve({ status: res.statusCode, body: json, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const get  = (path, hdrs)       => request('GET',  path, null, hdrs);
const post = (path, body, hdrs) => request('POST', path, body, hdrs);

// ── Lifecycle ─────────────────────────────────────────────────────────────────

before(async () => {
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(() => server.close());

// ── Health ────────────────────────────────────────────────────────────────────

test('GET /health returns ok', async () => {
  const { status, body } = await get('/health', {});
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
  assert.ok(body.ts);
});

// ── Auth ──────────────────────────────────────────────────────────────────────

describe('Authentication', () => {
  test('rejects missing API key', async () => {
    const { status } = await post('/v1/tickets', { value_cents: 100, property_id: 'P1' }, { 'Content-Type': 'application/json' });
    assert.equal(status, 401);
  });

  test('rejects wrong API key', async () => {
    const { status } = await post('/v1/tickets', { value_cents: 100, property_id: 'P1' }, { 'Content-Type': 'application/json', 'X-API-Key': 'wrong' });
    assert.equal(status, 403);
  });
});

// ── Issue ─────────────────────────────────────────────────────────────────────

describe('POST /v1/tickets — issue', () => {
  test('issues a ticket with valid body', async () => {
    const { status, body } = await post('/v1/tickets', {
      value_cents: 2500,
      property_id: 'PROP-001',
      machine_id:  'EGM-01',
    });
    assert.equal(status, 201);
    assert.ok(body.ticket_id);
    assert.ok(body.token);
    assert.ok(body.short_code);
    assert.equal(body.value_cents, 2500);
    assert.equal(body.currency, 'USD');
    assert.ok(body.issued_at);
  });

  test('rejects missing value_cents', async () => {
    const { status } = await post('/v1/tickets', { property_id: 'PROP-001' });
    assert.equal(status, 400);
  });

  test('rejects non-integer value_cents', async () => {
    const { status } = await post('/v1/tickets', { value_cents: 9.99, property_id: 'PROP-001' });
    assert.equal(status, 400);
  });

  test('rejects zero value_cents', async () => {
    const { status } = await post('/v1/tickets', { value_cents: 0, property_id: 'PROP-001' });
    assert.equal(status, 400);
  });

  test('rejects missing property_id', async () => {
    const { status } = await post('/v1/tickets', { value_cents: 100 });
    assert.equal(status, 400);
  });

  test('rejects oversized metadata', async () => {
    const { status } = await post('/v1/tickets', {
      value_cents: 100,
      property_id: 'PROP-001',
      metadata: { x: 'a'.repeat(5000) },
    });
    assert.equal(status, 400);
  });

  test('idempotency key returns same ticket on retry', async () => {
    const headers = { ...AUTH, 'Idempotency-Key': `idem-${Date.now()}` };
    const r1 = await post('/v1/tickets', { value_cents: 100, property_id: 'PROP-001' }, headers);
    const r2 = await post('/v1/tickets', { value_cents: 100, property_id: 'PROP-001' }, headers);
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 200);
    assert.equal(r1.body.ticket_id, r2.body.ticket_id);
    assert.equal(r2.headers['idempotency-replayed'], 'true');
  });
});

// ── Validate ──────────────────────────────────────────────────────────────────

describe('POST /v1/tickets/validate', () => {
  test('validates an issued ticket', async () => {
    const { body: issued } = await post('/v1/tickets', { value_cents: 500, property_id: 'PROP-001' });
    const { status, body } = await post('/v1/tickets/validate', { token: issued.token, property_id: 'PROP-001' });
    assert.equal(status, 200);
    assert.equal(body.valid, true);
    assert.equal(body.value_cents, 500);
    assert.ok(body.short_code);
  });

  test('returns invalid for unknown token', async () => {
    const { body } = await post('/v1/tickets/validate', { token: 'deadbeef'.repeat(8) });
    assert.equal(body.valid, false);
  });

  test('returns invalid for wrong property', async () => {
    const { body: issued } = await post('/v1/tickets', { value_cents: 100, property_id: 'PROP-001' });
    const { body } = await post('/v1/tickets/validate', { token: issued.token, property_id: 'PROP-999' });
    assert.equal(body.valid, false);
  });

  test('rejects missing token', async () => {
    const { status } = await post('/v1/tickets/validate', { property_id: 'PROP-001' });
    assert.equal(status, 400);
  });
});

// ── Redeem ────────────────────────────────────────────────────────────────────

describe('POST /v1/tickets/redeem', () => {
  test('redeems a valid ticket', async () => {
    const { body: issued } = await post('/v1/tickets', { value_cents: 1000, property_id: 'PROP-001' });
    const { status, body } = await post('/v1/tickets/redeem', {
      token:               issued.token,
      property_id:         'PROP-001',
      redemption_point_id: 'CAGE-01',
    });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.value_cents, 1000);
    assert.ok(body.redeemed_at);
  });

  test('prevents double-spend', async () => {
    const { body: issued } = await post('/v1/tickets', { value_cents: 500, property_id: 'PROP-001' });
    await post('/v1/tickets/redeem', { token: issued.token, property_id: 'PROP-001' });
    const { status, body } = await post('/v1/tickets/redeem', { token: issued.token, property_id: 'PROP-001' });
    assert.equal(status, 409);
    assert.equal(body.success, false);
  });

  test('rejects wrong property', async () => {
    const { body: issued } = await post('/v1/tickets', { value_cents: 100, property_id: 'PROP-001' });
    const { status, body } = await post('/v1/tickets/redeem', { token: issued.token, property_id: 'PROP-999' });
    assert.equal(status, 409);
    assert.equal(body.success, false);
  });

  test('rejects unknown token', async () => {
    const { status } = await post('/v1/tickets/redeem', { token: 'ff'.repeat(32), property_id: 'PROP-001' });
    assert.equal(status, 404);
  });

  test('rejects missing property_id', async () => {
    const { status } = await post('/v1/tickets/redeem', { token: 'ff'.repeat(32) });
    assert.equal(status, 400);
  });
});

// ── Get ticket ────────────────────────────────────────────────────────────────

describe('GET /v1/tickets/:id', () => {
  test('returns ticket by ID', async () => {
    const { body: issued } = await post('/v1/tickets', { value_cents: 250, property_id: 'PROP-001' });
    const { status, body } = await get(`/v1/tickets/${issued.ticket_id}`);
    assert.equal(status, 200);
    assert.equal(body.ticket_id, issued.ticket_id);
    assert.equal(body.status, 'issued');
    assert.ok(body.short_code);
  });

  test('returns 404 for unknown ticket', async () => {
    const { status } = await get('/v1/tickets/00000000-0000-0000-0000-000000000000');
    assert.equal(status, 404);
  });
});

// ── Audit trail ───────────────────────────────────────────────────────────────

describe('GET /v1/tickets/:id/audit', () => {
  test('returns audit events for a redeemed ticket', async () => {
    const { body: issued } = await post('/v1/tickets', { value_cents: 100, property_id: 'PROP-001' });
    await post('/v1/tickets/redeem', { token: issued.token, property_id: 'PROP-001' });
    const { body } = await get(`/v1/tickets/${issued.ticket_id}/audit`);
    assert.ok(Array.isArray(body.events));
    const types = body.events.map(e => e.event_type);
    assert.ok(types.includes('issued'));
    assert.ok(types.includes('redeemed'));
  });
});

// ── Short code lookup ─────────────────────────────────────────────────────────

describe('GET /v1/tickets/by-shortcode/:code', () => {
  test('finds ticket by short code', async () => {
    const { body: issued } = await post('/v1/tickets', { value_cents: 300, property_id: 'PROP-001' });
    const { status, body } = await get(`/v1/tickets/by-shortcode/${issued.short_code}`);
    assert.equal(status, 200);
    assert.equal(body.ticket_id, issued.ticket_id);
  });

  test('returns 404 for unknown short code', async () => {
    const { status } = await get('/v1/tickets/by-shortcode/ZZZZ-ZZZZ-ZZZZ');
    assert.equal(status, 404);
  });
});

// ── Void ──────────────────────────────────────────────────────────────────────

describe('POST /v1/tickets/:id/void', () => {
  test('voids an issued ticket', async () => {
    const { body: issued } = await post('/v1/tickets', { value_cents: 100, property_id: 'PROP-001' });
    const { status, body } = await post(`/v1/tickets/${issued.ticket_id}/void`, { reason: 'test' });
    assert.equal(status, 200);
    assert.equal(body.status, 'voided');
  });

  test('cannot void an already-redeemed ticket', async () => {
    const { body: issued } = await post('/v1/tickets', { value_cents: 100, property_id: 'PROP-001' });
    await post('/v1/tickets/redeem', { token: issued.token, property_id: 'PROP-001' });
    const { status } = await post(`/v1/tickets/${issued.ticket_id}/void`, {});
    assert.equal(status, 409);
  });
});

// ── Extend ────────────────────────────────────────────────────────────────────

describe('POST /v1/tickets/:id/extend', () => {
  test('extends expiry of an issued ticket', async () => {
    const { body: issued } = await post('/v1/tickets', { value_cents: 100, property_id: 'PROP-001' });
    const future = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
    const { status, body } = await post(`/v1/tickets/${issued.ticket_id}/extend`, { new_expires_at: future });
    assert.equal(status, 200);
    assert.equal(body.expires_at, future);
  });

  test('rejects past expiry', async () => {
    const { body: issued } = await post('/v1/tickets', { value_cents: 100, property_id: 'PROP-001' });
    const past = new Date(Date.now() - 1000).toISOString();
    const { status } = await post(`/v1/tickets/${issued.ticket_id}/extend`, { new_expires_at: past });
    assert.equal(status, 400);
  });
});

// ── Batch issue ───────────────────────────────────────────────────────────────

describe('POST /v1/tickets/batch', () => {
  test('issues multiple tickets atomically', async () => {
    const { status, body } = await post('/v1/tickets/batch', {
      property_id: 'PROP-001',
      tickets: [
        { value_cents: 100 },
        { value_cents: 200 },
        { value_cents: 300 },
      ],
    });
    assert.equal(status, 201);
    assert.equal(body.count, 3);
    assert.equal(body.issued.length, 3);
    for (const t of body.issued) {
      assert.ok(t.ticket_id);
      assert.ok(t.short_code);
    }
  });

  test('rejects batch exceeding 20 tickets', async () => {
    const { status } = await post('/v1/tickets/batch', {
      property_id: 'PROP-001',
      tickets: Array.from({ length: 21 }, () => ({ value_cents: 100 })),
    });
    assert.equal(status, 400);
  });
});

// ── List tickets ──────────────────────────────────────────────────────────────

describe('GET /v1/tickets', () => {
  test('lists tickets with pagination', async () => {
    const { status, body } = await get('/v1/tickets?property_id=PROP-001&limit=5');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.items));
    assert.ok(typeof body.has_more === 'boolean');
    assert.ok(typeof body.count === 'number');
  });

  test('filters by status', async () => {
    const { body } = await get('/v1/tickets?status=issued&limit=100');
    for (const t of body.items) assert.equal(t.status, 'issued');
  });
});

// ── Reports ───────────────────────────────────────────────────────────────────

describe('GET /v1/reports/stats', () => {
  test('returns aggregate stats', async () => {
    const { status, body } = await get('/v1/reports/stats?property_id=PROP-001');
    assert.equal(status, 200);
    assert.ok(body.totals);
    assert.ok(typeof body.totals.total_tickets === 'number');
  });
});

describe('GET /v1/reports/reconciliation', () => {
  test('returns reconciliation for a date', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { status, body } = await get(`/v1/reports/reconciliation?property_id=PROP-001&date=${today}`);
    assert.equal(status, 200);
    assert.equal(body.property_id, 'PROP-001');
    assert.ok(Array.isArray(body.summary));
  });

  test('requires property_id', async () => {
    const { status } = await get('/v1/reports/reconciliation?date=2026-04-13');
    assert.equal(status, 400);
  });

  test('requires valid date format', async () => {
    const { status } = await get('/v1/reports/reconciliation?property_id=PROP-001&date=not-a-date');
    assert.equal(status, 400);
  });
});

// ── Role-based access control ─────────────────────────────────────────────────

describe('RBAC — operator key', () => {
  test('operator can issue a ticket', async () => {
    const { status } = await post('/v1/tickets', { value_cents: 100, property_id: 'PROP-001' }, OPERATOR_AUTH);
    assert.equal(status, 201);
  });

  test('operator cannot redeem (cage role required)', async () => {
    const { body: issued } = await post('/v1/tickets', { value_cents: 100, property_id: 'PROP-001' });
    const { status } = await post('/v1/tickets/redeem', {
      token: issued.token, property_id: 'PROP-001',
    }, OPERATOR_AUTH);
    assert.equal(status, 403);
  });

  test('operator cannot access reports (admin role required)', async () => {
    const { status } = await get('/v1/reports/stats', OPERATOR_AUTH);
    assert.equal(status, 403);
  });
});

describe('RBAC — cage key', () => {
  test('cage can validate a ticket', async () => {
    const { body: issued } = await post('/v1/tickets', { value_cents: 100, property_id: 'PROP-001' });
    const { status, body } = await post('/v1/tickets/validate', {
      token: issued.token, property_id: 'PROP-001',
    }, CAGE_AUTH);
    assert.equal(status, 200);
    assert.equal(body.valid, true);
  });

  test('cage can redeem a ticket', async () => {
    const { body: issued } = await post('/v1/tickets', { value_cents: 100, property_id: 'PROP-001' });
    const { status, body } = await post('/v1/tickets/redeem', {
      token: issued.token, property_id: 'PROP-001', redemption_point_id: 'CAGE-01',
    }, CAGE_AUTH);
    assert.equal(status, 200);
    assert.equal(body.success, true);
  });

  test('cage cannot issue a ticket (operator role required)', async () => {
    const { status } = await post('/v1/tickets', { value_cents: 100, property_id: 'PROP-001' }, CAGE_AUTH);
    assert.equal(status, 403);
  });

  test('cage cannot void a ticket (operator role required)', async () => {
    const { body: issued } = await post('/v1/tickets', { value_cents: 100, property_id: 'PROP-001' });
    const { status } = await post(`/v1/tickets/${issued.ticket_id}/void`, {}, CAGE_AUTH);
    assert.equal(status, 403);
  });

  test('cage cannot access reports (admin role required)', async () => {
    const { status } = await get('/v1/reports/stats', CAGE_AUTH);
    assert.equal(status, 403);
  });
});

describe('RBAC — admin key', () => {
  test('admin can issue a ticket', async () => {
    const { status } = await post('/v1/tickets', { value_cents: 100, property_id: 'PROP-001' }, ADMIN_AUTH);
    assert.equal(status, 201);
  });

  test('admin can redeem a ticket', async () => {
    const { body: issued } = await post('/v1/tickets', { value_cents: 100, property_id: 'PROP-001' }, ADMIN_AUTH);
    const { status } = await post('/v1/tickets/redeem', {
      token: issued.token, property_id: 'PROP-001',
    }, ADMIN_AUTH);
    assert.equal(status, 200);
  });

  test('admin can access reports', async () => {
    const { status } = await get('/v1/reports/stats', ADMIN_AUTH);
    assert.equal(status, 200);
  });

  test('admin can view audit trail', async () => {
    const { body: issued } = await post('/v1/tickets', { value_cents: 100, property_id: 'PROP-001' }, ADMIN_AUTH);
    const { status } = await get(`/v1/tickets/${issued.ticket_id}/audit`, ADMIN_AUTH);
    assert.equal(status, 200);
  });

  test('non-admin cannot view audit trail', async () => {
    const { body: issued } = await post('/v1/tickets', { value_cents: 100, property_id: 'PROP-001' });
    const { status } = await get(`/v1/tickets/${issued.ticket_id}/audit`, OPERATOR_AUTH);
    assert.equal(status, 403);
  });
});

// ── Short code validate / redeem ──────────────────────────────────────────────

describe('Validate and redeem by short_code', () => {
  test('validate accepts short_code', async () => {
    const { body: issued } = await post('/v1/tickets', { value_cents: 400, property_id: 'PROP-001' });
    const { status, body } = await post('/v1/tickets/validate', {
      short_code: issued.short_code, property_id: 'PROP-001',
    });
    assert.equal(status, 200);
    assert.equal(body.valid, true);
    assert.equal(body.ticket_id, issued.ticket_id);
  });

  test('redeem accepts short_code', async () => {
    const { body: issued } = await post('/v1/tickets', { value_cents: 600, property_id: 'PROP-001' });
    const { status, body } = await post('/v1/tickets/redeem', {
      short_code: issued.short_code, property_id: 'PROP-001', redemption_point_id: 'CAGE-02',
    });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.value_cents, 600);
  });

  test('validate rejects when neither token nor short_code provided', async () => {
    const { status } = await post('/v1/tickets/validate', { property_id: 'PROP-001' });
    assert.equal(status, 400);
  });

  test('redeem rejects when neither token nor short_code provided', async () => {
    const { status } = await post('/v1/tickets/redeem', { property_id: 'PROP-001' });
    assert.equal(status, 400);
  });
});

// ── Currency validation ───────────────────────────────────────────────────────

describe('Currency validation', () => {
  test('accepts valid 3-letter currency code', async () => {
    const { status } = await post('/v1/tickets', {
      value_cents: 100, property_id: 'PROP-001', currency: 'EUR',
    });
    assert.equal(status, 201);
  });

  test('rejects invalid currency code', async () => {
    const { status } = await post('/v1/tickets', {
      value_cents: 100, property_id: 'PROP-001', currency: 'us',
    });
    assert.equal(status, 400);
  });

  test('rejects numeric currency', async () => {
    const { status } = await post('/v1/tickets', {
      value_cents: 100, property_id: 'PROP-001', currency: '840',
    });
    assert.equal(status, 400);
  });
});

// ── QR PNG endpoint ───────────────────────────────────────────────────────────

describe('GET /v1/tickets/:id/qr.png', () => {
  test('returns PNG bytes for an issued ticket', async () => {
    const { body: issued } = await post('/v1/tickets', { value_cents: 100, property_id: 'PROP-001' });
    const res = await new Promise((resolve, reject) => {
      const req = require('node:http').request(
        baseUrl + `/v1/tickets/${issued.ticket_id}/qr.png`,
        { method: 'GET', headers: AUTH },
        (r) => {
          const chunks = [];
          r.on('data', c => chunks.push(c));
          r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
        }
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.ok(res.body.length > 0);
    // PNG magic bytes: 89 50 4E 47
    assert.equal(res.body[0], 0x89);
    assert.equal(res.body[1], 0x50);
    assert.equal(res.body[2], 0x4E);
    assert.equal(res.body[3], 0x47);
  });

  test('returns 410 for a redeemed ticket', async () => {
    const { body: issued } = await post('/v1/tickets', { value_cents: 100, property_id: 'PROP-001' });
    await post('/v1/tickets/redeem', { token: issued.token, property_id: 'PROP-001' });
    const { status } = await get(`/v1/tickets/${issued.ticket_id}/qr.png`);
    assert.equal(status, 410);
  });
});

// ── Reports — top machines ────────────────────────────────────────────────────

describe('GET /v1/reports/top-machines', () => {
  test('returns top machines for a property', async () => {
    const { status, body } = await get('/v1/reports/top-machines?property_id=PROP-001');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.machines));
  });

  test('requires property_id', async () => {
    const { status } = await get('/v1/reports/top-machines');
    assert.equal(status, 400);
  });
});

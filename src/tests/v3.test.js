process.env.DB_PATH = ':memory:';
process.env.API_KEYS = 'test-key';
process.env.ADMIN_KEYS = 'admin-key';
process.env.OPERATOR_KEYS = 'operator-key';
process.env.CAGE_KEYS = 'cage-key';
process.env.PORT = '0';
process.env.TICKET_TTL_SECONDS = '0';
process.env.LOG_LEVEL = 'error';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../index');

let server;
let baseUrl;
const ADMIN = { 'Content-Type': 'application/json', 'X-API-Key': 'admin-key' };
const OPERATOR = { 'Content-Type': 'application/json', 'X-API-Key': 'operator-key' };
const CAGE = { 'Content-Type': 'application/json', 'X-API-Key': 'cage-key' };

function request(method, path, body, headers = ADMIN) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(baseUrl + path, {
      method,
      headers: { ...headers, ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); } catch (_) { json = data; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const post = (p, b, h) => request('POST', p, b, h);
const get = (p, h) => request('GET', p, null, h);

before(async () => {
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(() => server.close());

describe('v3 features', () => {
  test('issue ticket with player_id binding', async () => {
    const r = await post('/v1/tickets', {
      value_cents: 1500,
      property_id: 'PROP-V3',
      machine_id: 'EGM-9',
      player_id: 'PLAYER-42',
      account_id: 'acct-99',
    }, OPERATOR);
    assert.equal(r.status, 201);
    assert.equal(r.body.player_id, 'PLAYER-42');
    assert.equal(r.body.account_id, 'acct-99');
  });

  test('list tickets by player_id', async () => {
    const r = await get('/v1/players/PLAYER-42/tickets?property_id=PROP-V3', CAGE);
    assert.equal(r.status, 200);
    assert.ok(r.body.tickets.length >= 1);
  });

  test('slot connector cash-out', async () => {
    const r = await post('/v1/connectors/slot/cash-out', {
      value_cents: 2000,
      property_id: 'PROP-V3',
      machine_id: 'EGM-10',
      card_id: 'CARD-777',
    }, OPERATOR);
    assert.equal(r.status, 201);
    assert.equal(r.body.connector, 'slot');
    assert.equal(r.body.player_id, 'CARD-777');
  });

  test('slot connector ticket-in redeems', async () => {
    const issued = await post('/v1/tickets', {
      value_cents: 500,
      property_id: 'PROP-V3',
      machine_id: 'EGM-11',
    }, OPERATOR);
    const r = await post('/v1/connectors/slot/ticket-in', {
      token: issued.body.token,
      property_id: 'PROP-V3',
      machine_id: 'EGM-11',
    }, OPERATOR);
    assert.equal(r.status, 200);
    assert.equal(r.body.success, true);
  });

  test('health reports sqlite driver', async () => {
    const r = await get('/health', {});
    assert.equal(r.status, 200);
    assert.equal(r.body.db, 'sqlite');
  });
});

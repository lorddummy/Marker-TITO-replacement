require('dotenv').config();

const crypto    = require('crypto');
const express   = require('express');
const path      = require('path');
const rateLimit = require('express-rate-limit');

const { requireApiKey } = require('./middleware/auth');
const ticketRoutes      = require('./routes/tickets');
const reportRoutes      = require('./routes/reports');
const playerRoutes      = require('./routes/players');
const connectorRoutes   = require('./routes/connectors');
const logger            = require('./utils/logger');
const { getDb }         = require('./db/db');
const { getDbAsync }    = require('./db/asyncDb');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Global middleware ─────────────────────────────────────────────────────────

// Limit request body to 1 MB to prevent abuse
app.use(express.json({ limit: '1mb' }));

// CORS: allow any origin by default; tighten with CORS_ORIGIN env var in production
app.use((req, res, next) => {
  const origin = process.env.CORS_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Idempotency-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Request ID + response time
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  req.startedAt = Date.now();
  res.setHeader('X-Request-Id', req.requestId);

  res.on('finish', () => {
    const ms = Date.now() - req.startedAt;
    logger.info('Request completed', {
      id:     req.requestId,
      method: req.method,
      path:   req.path,
      status: res.statusCode,
      ms,
    });
  });

  next();
});

// Rate limiting: 200 req/min per IP (configurable via env)
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS  || '60000', 10),
  max:      parseInt(process.env.RATE_LIMIT_MAX         || '200',   10),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests. Please slow down.' },
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip,
});
app.use(limiter);

app.use('/cage', express.static(path.join(__dirname, '..', 'public', 'cage')));

// ── Health / readiness ────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  try {
    const driver = process.env.DATABASE_URL ? 'postgres' : 'sqlite';
    let ticket_count;
    if (process.env.DATABASE_URL) {
      const db = await getDbAsync();
      const row = await db.get('SELECT COUNT(*)::int AS ticket_count FROM tickets');
      ticket_count = row?.ticket_count ?? 0;
    } else {
      const db = getDb();
      ticket_count = db.prepare('SELECT COUNT(*) AS ticket_count FROM tickets').get().ticket_count;
    }
    res.status(200).json({
      status: 'ok',
      ts:     new Date().toISOString(),
      db:     driver,
      tickets: ticket_count,
      version: require('./package.json').version,
    });
  } catch (err) {
    res.status(503).json({ status: 'error', detail: err.message });
  }
});

// ── API routes ────────────────────────────────────────────────────────────────

app.use('/v1/tickets', requireApiKey, ticketRoutes);
app.use('/v1/reports', requireApiKey, reportRoutes);
app.use('/v1/players', requireApiKey, playerRoutes);
app.use('/v1/connectors', requireApiKey, connectorRoutes);

// Discoverability root
app.get('/', (_req, res) => res.json({
  name:    'Marker-TITO API',
  version: require('./package.json').version,
  docs:    'https://github.com/g8tsz/Marker-TITO-replacement/tree/master/docs',
  endpoints: {
    health:          'GET  /health',
    list_tickets:    'GET  /v1/tickets',
    issue_ticket:    'POST /v1/tickets',
    batch_issue:     'POST /v1/tickets/batch',
    validate_ticket: 'POST /v1/tickets/validate',
    redeem_ticket:   'POST /v1/tickets/redeem',
    get_ticket:      'GET  /v1/tickets/:id',
    audit_trail:     'GET  /v1/tickets/:id/audit',
    qr_code:         'GET  /v1/tickets/:id/qr',
    void_ticket:     'POST /v1/tickets/:id/void',
    extend_expiry:   'POST /v1/tickets/:id/extend',
    by_shortcode:    'GET  /v1/tickets/by-shortcode/:code',
    stats:           'GET  /v1/reports/stats',
    reconciliation:  'GET  /v1/reports/reconciliation',
    top_machines:    'GET  /v1/reports/top-machines',
    player_tickets:  'GET  /v1/players/:id/tickets',
    slot_cash_out:   'POST /v1/connectors/slot/cash-out',
    slot_ticket_in:  'POST /v1/connectors/slot/ticket-in',
    cage_ui:         'GET  /cage/',
  },
}));

// ── Error handlers ────────────────────────────────────────────────────────────

app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', { message: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error.' });
});

// ── Start ─────────────────────────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    if (process.env.DATABASE_URL) await getDbAsync();
    else getDb();
    app.listen(PORT, () => {
      logger.info('Marker-TITO API listening', { port: PORT, db: process.env.DATABASE_URL ? 'postgres' : 'sqlite' });
    });
  })().catch(err => {
    logger.error('Startup failed', { message: err.message });
    process.exit(1);
  });
}

module.exports = app;

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

let _db = null;

function getDb() {
  if (_db) return _db;

  const dbPath = process.env.DB_PATH || './data/tito.db';
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new Database(dbPath);

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  _db.exec(schema);

  _runMigrations(_db);

  return _db;
}

function _runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map(r => r.name)
  );

  const migrations = [
    {
      name: '001_add_short_code_column',
      up: () => {
        const cols = db.prepare('PRAGMA table_info(tickets)').all().map(c => c.name);
        if (!cols.includes('short_code')) {
          db.exec('ALTER TABLE tickets ADD COLUMN short_code TEXT');
          db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_short_code ON tickets (short_code)');
          const tickets = db.prepare('SELECT ticket_id, metadata FROM tickets WHERE short_code IS NULL').all();
          const update = db.prepare('UPDATE tickets SET short_code = ? WHERE ticket_id = ?');
          for (const t of tickets) {
            let sc = null;
            try { sc = JSON.parse(t.metadata || '{}').short_code; } catch (_) {}
            update.run(sc || `MIGR-${t.ticket_id.slice(0, 8).toUpperCase()}`, t.ticket_id);
          }
        }
      },
    },
    {
      name: '002_add_extended_audit_event_type',
      up: () => {},
    },
    {
      name: '003_add_idempotency_keys_table',
      up: () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS idempotency_keys (
            idem_key    TEXT NOT NULL,
            property_id TEXT NOT NULL,
            ticket_id   TEXT NOT NULL REFERENCES tickets (ticket_id),
            created_at  TEXT NOT NULL,
            PRIMARY KEY (idem_key, property_id)
          )
        `);
      },
    },
    {
      name: '004_add_composite_index',
      up: () => {
        db.exec('CREATE INDEX IF NOT EXISTS idx_tickets_prop_status ON tickets (property_id, status)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_events (event_type)');
      },
    },
    {
      name: '005_player_identity_columns',
      up: () => {
        const cols = db.prepare('PRAGMA table_info(tickets)').all().map(c => c.name);
        if (!cols.includes('account_id')) {
          db.exec('ALTER TABLE tickets ADD COLUMN account_id TEXT');
        }
        if (!cols.includes('player_id')) {
          db.exec('ALTER TABLE tickets ADD COLUMN player_id TEXT');
        }
        db.exec('CREATE INDEX IF NOT EXISTS idx_tickets_player ON tickets (player_id) WHERE player_id IS NOT NULL');
        db.exec('CREATE INDEX IF NOT EXISTS idx_tickets_account ON tickets (account_id) WHERE account_id IS NOT NULL');
      },
    },
  ];

  const markApplied = db.prepare(
    'INSERT OR IGNORE INTO _migrations (name, applied_at) VALUES (?, ?)'
  );

  for (const m of migrations) {
    if (applied.has(m.name)) continue;
    db.transaction(() => {
      m.up();
      markApplied.run(m.name, new Date().toISOString());
    })();
  }
}

module.exports = { getDb };

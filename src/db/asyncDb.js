const fs = require('fs');
const path = require('path');

function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

class PostgresDb {
  constructor(pool) {
    this.pool = pool;
  }

  async get(sql, params = []) {
    const r = await this.pool.query(convertPlaceholders(sql), params);
    return r.rows[0];
  }

  async all(sql, params = []) {
    const r = await this.pool.query(convertPlaceholders(sql), params);
    return r.rows;
  }

  async run(sql, params = []) {
    await this.pool.query(convertPlaceholders(sql), params);
  }

  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tx = {
        get: (s, p) => client.query(convertPlaceholders(s), p).then(r => r.rows[0]),
        all: (s, p) => client.query(convertPlaceholders(s), p).then(r => r.rows),
        run: (s, p) => client.query(convertPlaceholders(s), p),
      };
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  prepare(sql) {
    const self = this;
    return {
      get: (...params) => self.get(sql, params),
      all: (...params) => self.all(sql, params),
      run: (...params) => self.run(sql, params),
    };
  }

  transactionSync(fn) {
    return this.transaction(fn);
  }
}

class SqliteDb {
  constructor(db) {
    this.db = db;
  }

  get(sql, params = []) {
    return Promise.resolve(this.db.prepare(sql).get(...params));
  }

  all(sql, params = []) {
    return Promise.resolve(this.db.prepare(sql).all(...params));
  }

  run(sql, params = []) {
    return Promise.resolve(this.db.prepare(sql).run(...params));
  }

  transaction(fn) {
    return Promise.resolve(this.db.transaction(() => {
      const tx = {
        get: (s, p) => this.db.prepare(s).get(...p),
        all: (s, p) => this.db.prepare(s).all(...p),
        run: (s, p) => this.db.prepare(s).run(...p),
      };
      return fn(tx);
    })());
  }

  prepare(sql) {
    const stmt = this.db.prepare(sql);
    return {
      get: (...params) => Promise.resolve(stmt.get(...params)),
      all: (...params) => Promise.resolve(stmt.all(...params)),
      run: (...params) => Promise.resolve(stmt.run(...params)),
    };
  }

  transactionSync(fn) {
    return Promise.resolve(this.db.transaction(fn)());
  }
}

let _adapter = null;

async function getDbAsync() {
  if (_adapter) return _adapter;
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const schema = fs.readFileSync(path.join(__dirname, 'schema.postgres.sql'), 'utf8');
    await pool.query(schema);
    _adapter = new PostgresDb(pool);
    return _adapter;
  }
  const { getDb: getSqlite } = require('./sqlite');
  _adapter = new SqliteDb(getSqlite());
  return _adapter;
}

function getDb() {
  if (process.env.DATABASE_URL) {
    throw new Error('Use await getDbAsync() when DATABASE_URL is set');
  }
  const { getDb: getSqlite } = require('./sqlite');
  return getSqlite();
}

module.exports = { getDb, getDbAsync, convertPlaceholders };

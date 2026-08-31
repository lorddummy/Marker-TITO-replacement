-- PostgreSQL schema for Marker-TITO (use with DATABASE_URL)

CREATE TABLE IF NOT EXISTS tickets (
    ticket_id           TEXT PRIMARY KEY,
    token               TEXT NOT NULL UNIQUE,
    short_code          TEXT NOT NULL UNIQUE,
    value_cents         INTEGER NOT NULL CHECK (value_cents > 0),
    currency            TEXT NOT NULL DEFAULT 'USD',
    property_id         TEXT NOT NULL,
    machine_id          TEXT,
    account_id          TEXT,
    player_id           TEXT,
    status              TEXT NOT NULL DEFAULT 'issued'
        CHECK (status IN ('issued', 'redeemed', 'voided', 'expired')),
    issued_at           TIMESTAMPTZ NOT NULL,
    expires_at          TIMESTAMPTZ,
    redeemed_at         TIMESTAMPTZ,
    redemption_point_id TEXT,
    voided_at           TIMESTAMPTZ,
    void_reason         TEXT,
    metadata            JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_tickets_token ON tickets (token);
CREATE INDEX IF NOT EXISTS idx_tickets_short_code ON tickets (short_code);
CREATE INDEX IF NOT EXISTS idx_tickets_property ON tickets (property_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status);
CREATE INDEX IF NOT EXISTS idx_tickets_player ON tickets (player_id) WHERE player_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_account ON tickets (account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_prop_status ON tickets (property_id, status);

CREATE TABLE IF NOT EXISTS audit_events (
    event_id        TEXT PRIMARY KEY,
    ticket_id       TEXT NOT NULL REFERENCES tickets (ticket_id),
    event_type      TEXT NOT NULL
        CHECK (event_type IN ('issued','validated','redeemed','voided','expired','extended')),
    actor_id        TEXT,
    property_id     TEXT,
    occurred_at     TIMESTAMPTZ NOT NULL,
    detail          JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_ticket ON audit_events (ticket_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    idem_key        TEXT NOT NULL,
    property_id     TEXT NOT NULL,
    ticket_id       TEXT NOT NULL REFERENCES tickets (ticket_id),
    created_at      TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (idem_key, property_id)
);

CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL
);

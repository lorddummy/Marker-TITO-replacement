# Marker-TITO Replacement

**Digital replacement for the IRL casino ticket system** — the paper vouchers printed by slot machines and redeemed at the cage or another machine, now fully digital.

---

## What This Replaces

In casinos today:

- **Ticket Out:** Player cashes out at a slot → a **paper voucher** prints (barcode, value, security code).
- **Ticket In:** Player takes that slip to another machine or the cage → it is scanned → value is credited or paid out.
- **Markers:** At table games, paper **markers** (credit slips) work the same way.

This project replaces that **paper flow with digital tickets**: issue → store → present (QR code or short alphanumeric code) → validate → redeem, with a full immutable audit trail and no paper.

---

## Status — V3

| Feature | Status |
|---------|--------|
| Issue / validate / redeem / void / extend tickets | ✅ Done |
| QR codes, short codes, batch issue, idempotency | ✅ Done |
| RBAC, audit trail, reports, rate limits, Docker | ✅ Done |
| **PostgreSQL backend** | ✅ `DATABASE_URL` or `docker compose --profile postgres up` |
| **Player identity binding** | ✅ `player_id`, `account_id`, `card_id` on issue; `GET /v1/players/:id/tickets` |
| **Slot system connectors** | ✅ `POST /v1/connectors/slot/cash-out`, `POST /v1/connectors/slot/ticket-in` |
| **Web dashboard / cage UI** | ✅ [http://localhost:3000/cage/](http://localhost:3000/cage/) |
| Account System integration | ✅ [docs/INTEGRATION_WITH_ACCOUNTS.md](docs/INTEGRATION_WITH_ACCOUNTS.md) |

**Release:** [v3.0.0](CHANGELOG.md) — PostgreSQL, player binding, slot connectors, cage UI.

---

## Quick Start

### Prerequisites

- Node.js ≥ 18
- npm

### 1. Clone & install

```bash
git clone https://github.com/g8tsz/Marker-TITO-replacement.git
cd Marker-TITO-replacement/src
npm install
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env — at minimum set API_KEYS (or use the role-based RBAC keys)
```

Minimal `.env`:

```
API_KEYS=your-secret-key
PORT=3000
```

Full RBAC setup (recommended for production):

```
ADMIN_KEYS=your-admin-key
OPERATOR_KEYS=your-egm-integration-key
CAGE_KEYS=your-cage-reader-key
```

### 3. Run

```bash
npm start
# or for development with auto-reload:
npm run dev
```

Server starts on `http://localhost:3000`.

### 4. Docker

```bash
# SQLite (default)
docker compose up

# PostgreSQL backend
docker compose --profile postgres up api-postgres
```

Set `DATABASE_URL=postgres://tito:tito@localhost:5432/tito` for local Postgres without Compose profile.

### 5. Cage web UI

Open **http://localhost:3000/cage/** — enter your **CAGE_KEYS** value, property ID, and token or short code to validate/redeem. No install required; runs in the browser against your API.

### 6. Try it (curl)

```bash
# Issue a ticket
curl -s -X POST http://localhost:3000/v1/tickets \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{"value_cents": 2500, "property_id": "PROP-001", "machine_id": "EGM-42", "player_id": "CARD-001", "account_id": "acct-uuid"}'

# Slot connector (EGM cash-out)
curl -s -X POST http://localhost:3000/v1/connectors/slot/cash-out \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-operator-key" \
  -d '{"value_cents": 2500, "property_id": "PROP-001", "machine_id": "EGM-42", "card_id": "CARD-001"}'

# Player ticket history
curl -s http://localhost:3000/v1/players/CARD-001/tickets?property_id=PROP-001 \
  -H "X-API-Key: your-secret-key"

# Validate by token
curl -s -X POST http://localhost:3000/v1/tickets/validate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{"token": "<token>", "property_id": "PROP-001"}'

# Validate by short code (cage staff can type this in manually)
curl -s -X POST http://localhost:3000/v1/tickets/validate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{"short_code": "ABCD-EFGH-JKLM", "property_id": "PROP-001"}'

# Redeem
curl -s -X POST http://localhost:3000/v1/tickets/redeem \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{"token": "<token>", "property_id": "PROP-001", "redemption_point_id": "CAGE-01"}'

# Get QR code as PNG (embed in HTML: <img src="/v1/tickets/:id/qr.png">)
curl -s http://localhost:3000/v1/tickets/<ticket_id>/qr.png \
  -H "X-API-Key: your-secret-key" -o ticket.png
```

---

## Role-Based Access Control (RBAC)

API keys are assigned a **role** via environment variables. Each role restricts which operations a key can perform — critical for real casino deployments where EGMs, cage terminals, and management systems need least-privilege access.

| Env var | Role | Permitted operations |
|-----------------|----------|----------------------------------------------|
| `ADMIN_KEYS` | `admin` | Full access — all operations including reports and audit trails |
| `API_KEYS` | `admin` | Backward-compatible full access (same as `ADMIN_KEYS`) |
| `OPERATOR_KEYS` | `operator` | Issue, void, extend, batch — EGM / table integrations |
| `CAGE_KEYS` | `cage` | Validate and redeem — cage / kiosk readers |

All env vars accept comma-separated lists of keys. A key found in `ADMIN_KEYS` always wins (highest privilege).

### Endpoint permissions

| Endpoint | operator | cage | admin |
|----------------------------------------|----------|------|-------|
| `POST /v1/tickets` (issue) | ✅ | ❌ | ✅ |
| `POST /v1/tickets/batch` | ✅ | ❌ | ✅ |
| `POST /v1/tickets/validate` | ❌ | ✅ | ✅ |
| `POST /v1/tickets/redeem` | ❌ | ✅ | ✅ |
| `POST /v1/tickets/:id/void` | ✅ | ❌ | ✅ |
| `POST /v1/tickets/:id/extend` | ✅ | ❌ | ✅ |
| `GET /v1/tickets` (list) | ✅ | ❌ | ✅ |
| `GET /v1/tickets/:id` | ✅ | ✅ | ✅ |
| `GET /v1/tickets/:id/qr` / `qr.png` | ✅ | ✅ | ✅ |
| `GET /v1/tickets/by-shortcode/:code` | ✅ | ✅ | ✅ |
| `GET /v1/tickets/:id/audit` | ❌ | ❌ | ✅ |
| `GET /v1/reports/top-machines` | ❌ | ❌ | ✅ |
| `GET /v1/players/:id/tickets` | ✅ | ✅ | ✅ |
| `POST /v1/connectors/slot/cash-out` | ✅ | ❌ | ✅ |
| `POST /v1/connectors/slot/ticket-in` | ✅ | ✅ | ✅ |
| `GET /cage/` (web UI) | — | — | — (browser; uses cage key in UI) |

---

## API Overview

All endpoints under `/v1/` require an `X-API-Key` header.

| Method | Path | Description |
|--------|----------------------------------------|--------------------------------------|
| GET | `/health` | Health check (no auth) |
| GET | `/v1/tickets` | List tickets (filter + pagination) |
| POST | `/v1/tickets` | Issue a new ticket |
| POST | `/v1/tickets/batch` | Issue up to 20 tickets atomically |
| POST | `/v1/tickets/validate` | Validate (non-destructive) |
| POST | `/v1/tickets/redeem` | Atomically redeem |
| GET | `/v1/tickets/:id` | Get full ticket state |
| GET | `/v1/tickets/:id/audit` | Full audit trail |
| GET | `/v1/tickets/:id/qr` | QR code as JSON data URL |
| GET | `/v1/tickets/:id/qr.png` | QR code as raw PNG image |
| POST | `/v1/tickets/:id/void` | Void an unspent ticket |
| POST | `/v1/tickets/:id/extend` | Extend expiry |
| GET | `/v1/tickets/by-shortcode/:code` | Look up by short code |
| GET | `/v1/reports/stats` | Aggregate stats |
| GET | `/v1/reports/reconciliation` | Daily reconciliation report |
| GET | `/v1/reports/top-machines` | Top issuing EGMs |
| GET | `/v1/players/:player_id/tickets` | Tickets for player/account/card id |
| POST | `/v1/connectors/slot/cash-out` | EGM cash-out → issue + bind player |
| POST | `/v1/connectors/slot/ticket-in` | EGM ticket-in → redeem |
| GET | `/cage/` | Cage validate/redeem web UI (no API key in URL) |

### Player identity binding

On `POST /v1/tickets` (and slot cash-out), set any of:

- `player_id` — player or card identity
- `account_id` — [Account-system](https://github.com/g8tsz/Account-system) account UUID
- `card_id` — alias for `player_id`

Values are stored on the ticket row and in `metadata` for downstream redemption / account credit.

### PostgreSQL

Default is **SQLite** (`DB_PATH`). For production:

```bash
export DATABASE_URL=postgres://user:pass@host:5432/tito
npm start
```

Or `docker compose --profile postgres up api-postgres`. Schema auto-applies from `src/db/schema.postgres.sql`. `/health` reports `"db": "postgres"`.

---

Both `/validate` and `/redeem` accept either a `token` (64-hex string) or a `short_code` (e.g. `ABCD-EFGH-JKLM`). Short codes are useful when cage staff type in values manually from a printed or displayed code.

```json
POST /v1/tickets/redeem
{
  "short_code": "ABCD-EFGH-JKLM",
  "property_id": "PROP-001",
  "redemption_point_id": "CAGE-01"
}
```

### Idempotency

Add an `Idempotency-Key` header to `POST /v1/tickets` for safe retries on network failure. If the same key is used again for the same `property_id`, the original ticket is returned with an `Idempotency-Replayed: true` header.

See [`docs/API.md`](docs/API.md) for full request/response schemas and error codes.

---

## Repo Structure

```
Marker-TITO-replacement/
├── README.md
├── CHANGELOG.md
├── Dockerfile
├── docker-compose.yml        # SQLite API + optional Postgres profile
├── docker-compose.full.yml   # Tickets + Account-system stack
├── docs/                     # API, architecture, integration, security
├── public/cage/
│   └── index.html            # Cage validate/redeem web UI
├── scripts/                  # commit-clean.js, git hooks, CI checks
└── src/
    ├── index.js              # Express server entry point
    ├── package.json
    ├── .env.example
    ├── db/
    │   ├── db.js             # getDb() — SQLite or PostgreSQL
    │   ├── sqlite.js         # SQLite connection + migrations
    │   ├── asyncDb.js        # PostgreSQL pool + migrations
    │   ├── schema.sql        # SQLite DDL
    │   └── schema.postgres.sql
    ├── middleware/
    │   └── auth.js           # API key auth + RBAC
    ├── routes/
    │   ├── tickets.js        # /v1/tickets
    │   ├── reports.js        # /v1/reports (admin)
    │   ├── players.js        # /v1/players/:id/tickets
    │   └── connectors.js     # /v1/connectors/slot/*
    ├── services/
    │   ├── issue.js          # Shared issue logic (tickets + slot cash-out)
    │   └── redeem.js         # Shared redeem logic (tickets + slot ticket-in)
    ├── tests/
    │   ├── tickets.test.js   # Core lifecycle + RBAC
    │   └── v3.test.js        # Postgres, players, connectors, cage
    └── utils/
        ├── token.js
        ├── audit.js
        └── logger.js
```

---

## Security Highlights

- **Tokens** are 32 bytes of `crypto.randomBytes` — 2²⁵⁶ entropy, not guessable.
- **Short codes** use an unambiguous character set (no I, O, 0, 1) to reduce transcription errors.
- **API key comparison** uses HMAC digests with a random per-call key so neither the comparison timing nor the key length is leaked.
- **Redemption** is wrapped in a SQLite write transaction — concurrent calls cannot double-spend.
- **Audit events** are append-only — never updated or deleted.
- **Rate limiting** is enforced (configurable, default 200 req/min per IP).
- **RBAC** ensures EGMs cannot redeem and cage terminals cannot issue.

See [`docs/SECURITY.md`](docs/SECURITY.md) for the full threat model.

---

## Running Tests

```bash
cd src
npm test
# 65 tests — all pass
```

Tests use Node's built-in test runner (no extra dependencies). The suite covers the full lifecycle, RBAC enforcement, idempotency, short code flows, QR PNG output, and reports.

---

## Integration

See [`docs/INTEGRATION.md`](docs/INTEGRATION.md) for EGM/cage/kiosk flows.

**Account System (parallel wallet + sessions):** [`docs/INTEGRATION_WITH_ACCOUNTS.md`](docs/INTEGRATION_WITH_ACCOUNTS.md) — pairs with [g8tsz/Account-system](https://github.com/g8tsz/Account-system) v1.2 orchestration.

Run both APIs: `docker compose -f docker-compose.full.yml up` (requires `../Account-system` cloned).

---

## Contributing

See [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) and [`docs/PUSH.md`](docs/PUSH.md). Use `node scripts/commit-clean.js "message"` for commits.

---

## License

[MIT](LICENSE)

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

## Status — V2

| Feature | Status |
|----------------------------------|---------------|
| Issue tickets | ✅ Done |
| Validate tickets (token or short code) | ✅ Done |
| Redeem tickets (atomic, no double-spend) | ✅ Done |
| Void tickets | ✅ Done |
| Extend ticket expiry | ✅ Done |
| Batch issue (up to 20 tickets) | ✅ Done |
| Idempotency key support | ✅ Done |
| QR code — JSON data URL | ✅ Done |
| QR code — raw PNG image | ✅ Done |
| Short code generation + lookup | ✅ Done |
| Short code validate / redeem | ✅ Done |
| List tickets (filter + pagination) | ✅ Done |
| Role-based API keys (RBAC) | ✅ Done |
| Audit trail | ✅ Done |
| Reports: stats, reconciliation, top machines | ✅ Done |
| Rate limiting | ✅ Done |
| CORS support | ✅ Done |
| Docker + docker-compose | ✅ Done |
| Schema migrations | ✅ Done |
| Currency validation (ISO 4217) | ✅ Done |
| PostgreSQL backend | 🔲 Planned |
| Player identity binding | 🔲 Planned |
| Slot system connectors | 🔲 Planned |
| Web dashboard / cage UI | 🔲 Planned |

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
# Quick start with docker-compose (builds image, mounts data volume)
docker-compose up

# Or build and run manually
docker build -t marker-tito .
docker run -p 3000:3000 -e API_KEYS=secret -v tito-data:/data marker-tito
```

### 5. Try it

```bash
# Issue a ticket
curl -s -X POST http://localhost:3000/v1/tickets \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{"value_cents": 2500, "property_id": "PROP-001", "machine_id": "EGM-42"}'

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
| `GET /v1/reports/*` | ❌ | ❌ | ✅ |

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

### Validate and redeem by short code

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
├── Dockerfile
├── docker-compose.yml
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── INTEGRATION.md
│   ├── SECURITY.md
│   └── PUSH.md
└── src/
    ├── index.js             # Express server entry point
    ├── package.json
    ├── .env.example
    ├── db/
    │   ├── db.js            # SQLite connection + schema migrations
    │   └── schema.sql       # tickets, audit_events, idempotency_keys DDL
    ├── middleware/
    │   └── auth.js          # API key auth + role-based access control
    ├── routes/
    │   ├── tickets.js       # All /v1/tickets endpoints
    │   └── reports.js       # /v1/reports endpoints (admin only)
    ├── tests/
    │   └── tickets.test.js  # 60-test suite (Node built-in runner)
    └── utils/
        ├── token.js         # Crypto token, short code, HMAC-safe comparison
        ├── audit.js         # Audit event helpers
        └── logger.js        # Structured JSON logger
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
# 60 tests across 20 suites — all pass
```

Tests use Node's built-in test runner (no extra dependencies). The suite covers the full lifecycle, RBAC enforcement, idempotency, short code flows, QR PNG output, and reports.

---

## Integration

See [`docs/INTEGRATION.md`](docs/INTEGRATION.md) for:

- EGM cash-out flow (issue)
- Cage redemption flow (validate + redeem)
- Kiosk / ticket-in flow
- Short code manual entry flow
- Authentication and key rotation
- Idempotency considerations
- Compliance and reconciliation

---

## Contributing

Open an issue or PR. For integration or compliance questions, see `docs/`.

---

## License

[MIT](LICENSE)

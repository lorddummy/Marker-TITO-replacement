# Changelog

## [3.0.0] - 2026-07-29

### Added

- **PostgreSQL** via `DATABASE_URL` and `docker compose --profile postgres up api-postgres`.
- **Player identity binding** — `account_id`, `player_id`, `card_id` on issue; `GET /v1/players/:id/tickets`.
- **Slot connectors** — `/v1/connectors/slot/cash-out`, `/v1/connectors/slot/ticket-in`.
- **Cage web UI** at `/cage/` for validate/redeem in the browser.
- 5 new tests in `tests/v3.test.js` (65 total).

### Changed

- README updated: all former “Planned” V3 items marked done.
- Version `3.0.0` in `src/package.json`.

## [2.1.0] - 2026-07-29

### Added

- [docs/INTEGRATION_WITH_ACCOUNTS.md](docs/INTEGRATION_WITH_ACCOUNTS.md) — parallel flow with [Account System v1.2](https://github.com/g8tsz/Account-system).
- `docker-compose.full.yml` — run tickets + accounts together.
- GitHub Actions CI (tests + Cursor co-author guard).
- Contributor hygiene: [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md), git hooks, `scripts/commit-clean.js`.

### Changed

- README links to `g8tsz/Account-system`.

## [2.0.0] - 2026-04-14

RBAC, short-code redeem, QR PNG, Docker, 60-test suite — see git history.

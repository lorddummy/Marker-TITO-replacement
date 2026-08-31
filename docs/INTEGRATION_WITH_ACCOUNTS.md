# Integration with Account System

The **Ticket API** (this repo) and the **[Account System](https://github.com/g8tsz/Account-system)** run **in parallel** on the casino floor.

| System | Role |
|--------|------|
| **Account System** (`:3001`) | Who is seated, wallet balance, sessions, loyalty, orchestrated cash-out |
| **Marker-TITO** (`:3000`) | Digital voucher issue, validate, redeem |

## Shared conventions

- **`property_id`** — same property codes on both APIs
- **Amounts** — integer cents
- **Linkage** — set `metadata.account_id` when issuing tickets; account credits use `reference_id: ticket_id`

## Cash-out (EGM)

**Recommended:** use Account System orchestration (`POST /v1/orchestration/cash-out`) — it calls this ticket API and credits the account atomically. See [Account System ORCHESTRATION.md](https://github.com/g8tsz/Account-system/blob/master/docs/ORCHESTRATION.md).

**Manual (two calls):**

1. Account: `GET /v1/sessions/machine/:machine_id`
2. Ticket: `POST /v1/tickets` with `metadata: { account_id }`
3. Optional account credit with `reason: cash_out`

## Cage redemption

1. `POST /v1/tickets/redeem` (this API)
2. If `metadata.account_id` was set at issue, credit the account: `POST /v1/accounts/:id/credit` with `reason: ticket_redemption`, `reference_id: ticket_id`

## Run both locally

Clone both repos as siblings, then from **Account-system**:

```bash
docker compose -f docker-compose.full.yml up --build
```

Tickets on **3000**, accounts on **3001**. Set `TICKET_API_URL=http://tickets:3000` in Account-system `.env`.

## Summary

| Event | Account System | Ticket System |
|-------|----------------|---------------|
| Card in | Session | — |
| Cage load | Credit | — |
| Play | Debit/credit | — |
| Cash out | Optional credit / hold | Issue ticket |
| Redeem at cage | Optional credit | Redeem ticket |

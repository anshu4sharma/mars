# Order & Inventory Sync Service — Design

Take-home design for Mars Cosmetics, following the brief in [problem.md](problem.md).

Inventory sync for 4 channels and 1 warehouse, where the points that matter are the concurrency
problem, the ERP's 2-hour Sunday outage, and Nykaa's 5 req/s limit versus a 60-second freshness target.

## Read this first

| File | What it is |
|---|---|
| **[DESIGN.md](DESIGN.md)** | The main document — ~4 pages: architecture, data model, ingestion, the two-channels-last-unit walkthrough, stock push, failures, observability, scope. |
| [design/diagrams/architecture.png](design/diagrams/architecture.png) | The architecture diagram ([Mermaid source](design/diagrams/architecture.mmd), [SVG](design/diagrams/architecture.svg)). |
| [ASSUMPTIONS.md](ASSUMPTIONS.md) | Everything assumed where the brief was silent, plus the cost build-up (~₹32–37k/month). |
| [TRADEOFFS.md](TRADEOFFS.md) | Six decisions × chose / rejected / why. |
| [STRETCH.md](STRETCH.md) | Option A (second warehouse in Bengaluru); Option B (LLM) sketched for completeness. |
| [RESERVATION_PSEUDOCODE.md](RESERVATION_PSEUDOCODE.md) | The optional pseudo-code for the reservation step. |
| [AI_USAGE.md](AI_USAGE.md) | One-line AI usage note, plus what wasn't delegated. |
| [design/sql/](design/sql) | The reservation SQL, and the schema constraints it depends on. |
| [design/test/reservation_race.test.mjs](design/test/reservation_race.test.mjs) | **Runnable proof** of the concurrency claim against real PostgreSQL. |

## The 30-second version

1. **One writer of stock.** Every reservation, release and return goes through a single NestJS
   worker fleet, and each movement is one Postgres transaction:
   `UPDATE stock_levels SET reserved = reserved + qty WHERE sku = $1 AND on_hand - reserved >= qty`.
   With `UNIQUE(idempotency_key)` on the ledger and `CHECK(on_hand >= reserved)` on the row, that
   statement is all that stands between two channels and an oversell — and it holds under
   concurrency (proven below). Redis Streams carry events; they do not order them.
2. **Channels are mirrors.** A "dirty SKU" set plus per-channel token buckets push absolute stock
   values (`set to N`, never `-1`), urgent stock first. Nykaa's 5 req/s makes a full 1,200-SKU sweep
   take 240 s, so the doc commits to *changed SKUs within 60 s* and a full sweep every ≤5 min, and
   says so instead of pretending.
3. **ERP is out of the critical path.** A transactional outbox holds orders through the Sunday
   outage and drains ~36k rows in ~12 min. Exactly-once across HTTP isn't achievable alone, so the
   design commits to at-least-once + reconciliation with a named BC-side dependency.
4. **Failures are isolated per channel**, everything that stops retrying lands on an ops screen
   with a one-click idempotent retry, and five day-one metrics catch the things that fail silently
   — starting with cancellations attributed to stock, not just our own internal counter.

## Verify the concurrency claim

The brief says code isn't required; the reservation logic is the one place a claim is worth
proving rather than asserting. [design/verification.txt](design/verification.txt) is the output of:

```bash
docker run -d --rm --name mars-pg -e POSTGRES_PASSWORD=dev -p 55432:5432 postgres:16-alpine
npm install
env PGPORT=55432 PGPASSWORD=dev npm test
```

It runs the real §4 SQL against PostgreSQL 16. Checks:
two channels selling the last unit → **exactly one** winner and **one** ledger row; duplicate
webhooks (×10) and concurrent at-least-once redelivery (×25) → reserve once; 200 concurrent orders
against 50 units → exactly 50 succeed with the invariant intact; a multi-item cart that runs out of
stock mid-cart → fails atomically with no partial reservation.

The harness ships inside `design/`, so it isn't required for reading the design — it exists to make
the central claim checkable rather than assertive.

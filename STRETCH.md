# Stretch — a second warehouse in Bengaluru (Option A)

- **Stock becomes `(sku, warehouse_id)`**: `stock_levels` PK, ledger idempotency key, and `channel_stock.desired_qty = SUM(available)`. **ERP stays a passive sink** — our ledger is the only reservation authority, or the two drift.
- **New step: allocation** before reservation — pincode → zone → preferred warehouse, falling back to the other. Multi-warehouse carts **split** into two ERP documents, so cancellation must release the right warehouse's lines.
- **Subtle risk**: a channel sees the sum, which can be positive while no single warehouse has enough. The interlock checks allocation before confirming, and buffers are sized to the sum minus the largest imbalance.
- **Isolation improves**: Bengaluru down → east traffic fails over to main (flagged); main keeps selling.
- **Cost: no new infra** — `warehouse_id` on existing tables plus a zone map, on the same Postgres. That is the payoff of keeping the ledger in Postgres rather than inventing a stock service.

## Option B — LLM "why did SKU X oversell?" (not chosen, for completeness)

An LLM reads only a structured, pre-aggregated context from the ledger, `channel_stock` and order events; it must cite ledger row ids and a validator rejects claims whose rows don't exist or don't support them — that, not prompt wording, stops hallucination. Cost ≈ 4k input / 200 output tokens per question (₹0.50–2). Out of v1 because an incident review is the worst place for a confident wrong answer.

# Trade-offs

Each entry: what I chose, what I rejected, and why. Summarised in DESIGN.md §9.

| # | Decision | Chose | Rejected | Why |
|---|---|---|---|---|
| 1 | **Stock concurrency** | Postgres row lock + `WHERE on_hand - reserved >= qty` + idempotency key; SKU-sorted multi-item locks | Optimistic version-retry; Redis Lua as stock authority; SKU-sharded stream as the serialisation mechanism | Optimistic retries collapse under hot-SKU load at exactly the sale peak. Redis-as-truth loses the transaction tying stock to ERP intent and the audit trail. Sharding a queue moves the lock, not the problem. |
| 2 | **Source of truth** | Append-only ledger + one materialised row, both in Postgres | Redis counter as truth; `SUM(ledger)` per read | The ledger answers "why did stock change"; the materialised row keeps reads cheap and the lock narrow. |
| 3 | **Transport** | Redis Streams, one consumer group, transport only | Kafka/MSK; SQS per channel; sync processing in the webhook | Streams give consumer groups and `XAUTOCLAIM` on infra we already run. Kafka at 5 orders/s is ₹15–20k plus ops burden. |
| 4 | **ERP delivery** | Outbox + deterministic payload + idempotency key + pre-retry existence check | Fire-and-forget retries; 2PC with BC | 2PC with a third-party ERP is unworkable. We commit to at-least-once + reconciliation and name the BC dependency. |
| 5 | **Channel writes** | Absolute "set to N", priority lanes, per-channel token buckets | Delta pushes | Deltas double-apply on retry and break on out-of-order APIs. |
| 6 | **Oversell posture** | Small per-channel buffer + priority lanes; documented Nykaa 60 s limit | Block sales until all channels ack; hidden exposure-% throttle | Blocking all sales costs more revenue than the cancels it prevents; a hidden throttle factor would obscure the rate-limit arithmetic instead of documenting it. |

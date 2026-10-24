# Assumptions

Where the brief was silent, this is what I assumed. (See DESIGN.md §9 for the one-line summary.)

1. Webhooks are HMAC-signed per channel; outbound credentials live in Secrets Manager.
2. Channels send `event_time` and, where possible, a sequence; otherwise we use `received_at` and flag the order for reconciliation.
3. **BC can enforce uniqueness on `externalDocumentNo` (or the ERP team owns an inbox that de-dupes)** — the one external dependency for "exactly once".
4. Blinkit's webhook is the primary order source; its CSV is reconciliation only.
5. Stock is integer units; physical receipts arrive via BC/manual entry, not real-time.
6. **Cancel → release immediately** (nothing shipped). **Return → `in_transit`**, converted to `on_hand` only when the warehouse scans it; modelling returns as `available` would inflate stock before the unit is back.
7. The 60 s SLO means *changed* SKUs, not all 1,200 continuously.
8. One region, one Postgres primary, Multi-AZ; the ~₹50,000/month budget is all-in.
9. Payloads hold PII: encrypted at rest, 90-day retention, only pincode exposed to ops.

## Cost build-up

Fargate ~₹9–12k, RDS `db.t4g.medium` Multi-AZ ~₹14–16k, ElastiCache `cache.t4g.small` ~₹2.5k, ALB ~₹2k, S3/CloudFront/CloudWatch ~₹3k, Secrets ~₹1k → **≈ ₹32–37k**, leaving headroom for sale-day autoscaling. RDS and ElastiCache are the managed services worth buying; Kafka and a second database are not.

-- schema.sql — the parts of the data model that carry the concurrency design.
-- Verified against PostgreSQL 16 (see test/reservation_race.test.mjs).

DROP TABLE IF EXISTS inventory_ledger;
DROP TABLE IF EXISTS stock_levels;

CREATE TABLE stock_levels (
  sku          text PRIMARY KEY,
  on_hand      integer NOT NULL DEFAULT 0,
  reserved     integer NOT NULL DEFAULT 0,
  in_transit   integer NOT NULL DEFAULT 0,
  version      bigint  NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  available    integer GENERATED ALWAYS AS (on_hand - reserved) STORED,
  -- the last line of defence: even a buggy code path cannot drive these negative
  CONSTRAINT on_hand_nonneg   CHECK (on_hand   >= 0),
  CONSTRAINT reserved_nonneg  CHECK (reserved  >= 0),
  CONSTRAINT reserved_le_hand CHECK (on_hand   >= reserved)
);

CREATE TABLE inventory_ledger (
  id               bigserial PRIMARY KEY,
  sku              text NOT NULL,
  delta_reserved   integer NOT NULL DEFAULT 0,
  delta_on_hand    integer NOT NULL DEFAULT 0,
  -- returns go to in_transit, never straight to available
  delta_in_transit integer NOT NULL DEFAULT 0,
  reason           text NOT NULL,
  source_type      text NOT NULL,
  source_id        text NOT NULL,
  actor            text NOT NULL DEFAULT 'system',
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- THE idempotency barrier: one stock movement per (reason, source, sku), ever
  idempotency_key  text NOT NULL UNIQUE
);

CREATE INDEX inventory_ledger_sku_idx ON inventory_ledger (sku, id);

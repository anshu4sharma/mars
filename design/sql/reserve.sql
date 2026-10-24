-- reserve.sql — the reservation statement from DESIGN.md, verbatim.
-- Parameters: $1 order_id, $2 sku, $3 qty
--
-- Execute once per order item, inside ONE transaction for the whole order, with
-- SKU rows touched in sorted order (prevents deadlocks on multi-item carts).
-- Returns the row when the unit was reserved; returns NO ROW on:
--   * duplicate  — the idempotency key already exists (replay / duplicate webhook)
--   * no stock   — on_hand - reserved < qty
-- Both cases roll back the order and must NOT be retried blindly.
--
-- (Optional, as the brief allows: pseudo-code for the reservation step.)

WITH ledger AS (
  INSERT INTO inventory_ledger
    (sku, delta_reserved, reason, source_type, source_id, idempotency_key)
  VALUES
    ($2, $3, 'ORDER_RESERVED', 'ORDER', $1,
     $1 || ':' || $2)                    -- one reservation line per (order, sku)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id
)
UPDATE stock_levels
   SET reserved   = reserved + $3,
       version    = version + 1,
       updated_at = now()
 WHERE sku = $2
   AND on_hand - reserved >= $3           -- THE predicate, re-checked under the row lock
   AND EXISTS (SELECT 1 FROM ledger)      -- only if the ledger insert actually happened
RETURNING sku, (on_hand - reserved) AS available_after;

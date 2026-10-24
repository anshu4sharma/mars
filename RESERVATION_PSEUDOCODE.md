# Stock reservation — pseudo-code

The optional ask from the brief (question 4). This is the only "code" I wrote.

```
reserve(order):
  if !INSERT order_events(dedupe_key) -> ACK_DUPLICATE       # ON CONFLICT DO NOTHING
  order = upsertOrder(order)                                 # state machine
  if order.state in (CANCELLED, RETURNED):
      insertUnitLedger(order, RECONCILIATION); return NOT_APPLIED   # never re-reserve

  BEGIN;
  for item in sorted(order.items, by: sku):                  # sorted = no deadlocks
      if !INSERT inventory_ledger(+qty, 'ORDER_RESERVED', key=...)
                   ON CONFLICT DO NOTHING RETURNING id: continue    # replay, no-op
      if UPDATE stock_levels SET reserved = reserved + qty
              WHERE sku = item.sku AND on_hand - reserved >= qty   -- THE lock
         affected 0 rows: ROLLBACK; return INSUFFICIENT_STOCK(item)
      INSERT outbox(order.id, deterministicPayload)          # PENDING, same txn
  COMMIT;
  for sku: SADD dirty:{every channel} sku                    # after commit only

release(order, reason):                                      # CANCELLED | RETURN
  BEGIN;
  for item: if !INSERT ledger(-qty, reason) ON CONFLICT DO NOTHING: continue
            UPDATE stock_levels SET in_transit += qty        # RETURN
                   | reserved -= qty WHERE reserved >= qty    # CANCEL
  COMMIT; SADD dirty:{every channel} sku                      # push after commit

resolveInsufficient(item, order):
  WEBSITE -> failOrAwaitRestock + refund
  else    -> notifyChannelCancel; metric('oversell_blocked')
  queue(order, allocationRetryLane, max 15 min)              # restock may free it
```

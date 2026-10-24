// reservation_race.test.mjs — runs the real DESIGN.md §4 reservation SQL against
// a real PostgreSQL to prove the central claim: when two channels sell the last
// unit in the same second, exactly one order wins and exactly one ledger row exists.
//
// Usage:
//   docker run -d --rm --name mars-pg -e POSTGRES_PASSWORD=dev -p 55432:5432 postgres:16-alpine
//   node design/test/reservation_race.test.mjs
//
// Env: PGHOST (127.0.0.1), PGPORT (55432), PGUSER (postgres), PGPASSWORD (dev), PGDATABASE (postgres)

import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cfg = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 55432),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'dev',
  database: process.env.PGDATABASE ?? 'postgres',
};

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

const connect = () => {
  const c = new Client(cfg);
  return c.connect().then(() => c);
};

// The reservation as executed per item inside one transaction (DESIGN.md §4).
async function reserveOne(client, { orderId, sku, qty }) {
  const { rows } = await client.query(
    `WITH ledger AS (
       INSERT INTO inventory_ledger
         (sku, delta_reserved, reason, source_type, source_id, idempotency_key)
       VALUES ($2, $3, 'ORDER_RESERVED', 'ORDER', $1, $1 || ':' || $2)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id
     )
     UPDATE stock_levels
        SET reserved = reserved + $3, version = version + 1, updated_at = now()
      WHERE sku = $2
        AND on_hand - reserved >= $3
        AND EXISTS (SELECT 1 FROM ledger)
     RETURNING sku, (on_hand - reserved) AS available_after`,
    [orderId, sku, qty],
  );
  return rows[0] ?? null; // null => no stock
}

async function reserveInTxn(order) {
  const c = await connect();
  try {
    await c.query('BEGIN');
    const res = await reserveOne(c, order);
    if (!res) {
      await c.query('ROLLBACK');
      return { ok: false };
    }
    await c.query('COMMIT');
    return { ok: true, res };
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    await c.end();
  }
}

const state = async () => {
  const c = await connect();
  const { rows } = await c.query('SELECT on_hand, reserved, available FROM stock_levels WHERE sku = $1', [SKU]);
  const { rows: led } = await c.query('SELECT count(*)::int AS n FROM inventory_ledger WHERE sku = $1', [SKU]);
  await c.end();
  return { ...rows[0], ledgerRows: led[0].n };
};

const reset = async () => {
  const c = await connect();
  await c.query('DELETE FROM inventory_ledger');
  await c.query('DELETE FROM stock_levels');
  await c.query(`INSERT INTO stock_levels (sku, on_hand) VALUES ($1, 1)`, [SKU]);
  await c.end();
};

const SKU = 'MRS-LIP-104';

async function main() {
  const admin = await connect();
  await admin.query(readFileSync(join(here, '..', 'sql', 'schema.sql'), 'utf8'));
  await admin.end();

  // ---------------------------------------------------------------- 1
  await reset();
  {
    // Two different channels, one unit. Fire truly concurrently.
    const [nykaa, fk] = await Promise.all([
      reserveInTxn({ orderId: 'NYK-1', sku: SKU, qty: 1 }),
      reserveInTxn({ orderId: 'FK-1', sku: SKU, qty: 1 }),
    ]);
    const winners = [nykaa, fk].filter((r) => r.ok);
    const s = await state();
    check('two concurrent orders for the last unit: exactly one wins', winners.length === 1, JSON.stringify({ nykaa, fk }));
    check('ledger has exactly one reservation row', s.ledgerRows === 1, `got ${s.ledgerRows}`);
    check('available is 0, never negative', s.available === 0, `available=${s.available}`);
  }

  // ---------------------------------------------------------------- 2
  await reset();
  {
    // Same webhook delivered 10 times (Nykaa duplicates), not concurrently.
    for (let i = 0; i < 10; i++) await reserveInTxn({ orderId: 'NYK-DUP', sku: SKU, qty: 1 });
    const s = await state();
    check('duplicate webhook x10 reserves once', s.reserved === 1 && s.ledgerRows === 1, JSON.stringify(s));
  }

  // ---------------------------------------------------------------- 3
  await reset();
  {
    // Same event replayed concurrently (at-least-once redelivery after a crash).
    await Promise.all(Array.from({ length: 25 }, () => reserveInTxn({ orderId: 'NYK-REPLAY', sku: SKU, qty: 1 })));
    const s = await state();
    check('concurrent redelivery x25 reserves once', s.reserved === 1 && s.ledgerRows === 1, JSON.stringify(s));
  }

  // ---------------------------------------------------------------- 4
  {
    // 200 concurrent single-unit orders against 50 units, 5 different channels.
    const c = await connect();
    await c.query('DELETE FROM inventory_ledger');
    await c.query('DELETE FROM stock_levels');
    await c.query('INSERT INTO stock_levels (sku, on_hand) VALUES ($1, 50)', [SKU]);
    await c.end();
    const chans = ['WEBSITE', 'NYKAA', 'FLIPKART', 'BLINKIT'];
    const results = await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        reserveInTxn({ orderId: `${chans[i % 4]}-${i}`, sku: SKU, qty: 1 }),
      ),
    );
    const won = results.filter((r) => r.ok).length;
    const s = await state();
    check('200 concurrent orders vs 50 units: exactly 50 succeed', won === 50, `won=${won}`);
    check('stock invariant holds under load', s.available === 0 && s.reserved === 50 && s.ledgerRows === 50, JSON.stringify(s));
  }

  // ---------------------------------------------------------------- 5
  {
    // Multi-item cart: qty 3 when only 2 left -> whole order must fail atomically.
    const c = await connect();
    await c.query('DELETE FROM inventory_ledger');
    await c.query('DELETE FROM stock_levels');
    await c.query(`INSERT INTO stock_levels (sku, on_hand) VALUES ($1, 5), ('MRS-KJL-011', 2)`, [SKU]);
    await c.end();
    const res = await (async () => {
      const conn = await connect();
      try {
        await conn.query('BEGIN');
        const a = await reserveOne(conn, { orderId: 'CART-1', sku: SKU, qty: 2 });
        const b = a ? await reserveOne(conn, { orderId: 'CART-1', sku: 'MRS-KJL-011', qty: 3 }) : null;
        if (!a || !b) { await conn.query('ROLLBACK'); return false; }
        await conn.query('COMMIT');
        return true;
      } finally { await conn.end(); }
    })();
    const c2 = await connect();
    const { rows } = await c2.query('SELECT sku, reserved FROM stock_levels ORDER BY sku');
    await c2.end();
    check('multi-item cart fails atomically (no partial reservation)', !res && rows.every((r) => r.reserved === 0), JSON.stringify(rows));
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

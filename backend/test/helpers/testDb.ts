import { newDb } from 'pg-mem';
import type { Pool } from 'pg';

export function createTestPool(): Pool {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: 'uuid' as any,
    // `impure` is required: pg-mem treats a registered function as pure by
    // default and memoizes its result, so every DEFAULT gen_random_uuid() in
    // the same in-memory db would hand back the *same* UUID and the second
    // insert into a table would fail on its primary key.
    impure: true,
    implementation: () => crypto.randomUUID(),
  });
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  return pool as unknown as Pool;
}

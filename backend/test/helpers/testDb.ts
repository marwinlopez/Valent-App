import { newDb } from 'pg-mem';
import type { Pool } from 'pg';

export function createTestPool(): Pool {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: 'uuid' as any,
    implementation: () => crypto.randomUUID(),
  });
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  return pool as unknown as Pool;
}

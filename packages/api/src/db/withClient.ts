// packages/api/src/db/withClient.ts
// Read-path helper: checks out a pooled client for a query that does not mutate state, and always
// returns it. State-changing work uses transaction() from @fleet/db instead (D8).

import type { DbClient, PoolLike } from "@fleet/shared";

export async function withClient<T>(pool: PoolLike, fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release?.();
  }
}

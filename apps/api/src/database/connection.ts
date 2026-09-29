import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { AsyncLocalStorage } from "node:async_hooks";

export type SqlValue = string | number | boolean | Date | null | readonly string[] | string[] | readonly number[] | number[];
export type DatabaseClient = Pick<PoolClient, "query">;

let pool: Pool | undefined;
const transactionScope = new AsyncLocalStorage<DatabaseClient>();

// Used only by the legacy Inbox unit of work. Injected repositories still work normally.
export function inDatabaseTransaction<T>(client: DatabaseClient, operation: () => Promise<T>) {
  return transactionScope.run(client, operation);
}

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error("DATABASE_URL is not configured");
    }

    pool = new Pool({ connectionString });
  }

  return pool;
}

export async function checkDatabaseConnection() {
  await getPool().query("SELECT 1");
}

export async function query<T extends QueryResultRow>(text: string, values: SqlValue[] = []) {
  return (transactionScope.getStore() ?? getPool()).query<T>(text, values);
}

export async function withTransaction<T>(callback: (client: DatabaseClient) => Promise<T>) {
  const current = transactionScope.getStore();
  if (current) return callback(current);
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const result = await transactionScope.run(client, () => callback(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function withIndependentTransaction<T>(callback: (client: DatabaseClient) => Promise<T>) {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const result = await transactionScope.run(client, () => callback(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDatabaseConnection() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

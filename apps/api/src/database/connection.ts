import { Pool, type QueryResultRow } from "pg";

type SqlValue = string | number | boolean | Date | null;

let pool: Pool | undefined;

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
  return getPool().query<T>(text, values);
}

export async function closeDatabaseConnection() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

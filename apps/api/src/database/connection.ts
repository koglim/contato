import { Pool } from "pg";

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

export async function closeDatabaseConnection() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

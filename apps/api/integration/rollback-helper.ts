import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { query } from "../src/database/connection.js";

// Keep protected rollback tests valid as newer migrations are added. The CLI
// takes a count, never a migration filename. All downs share one transaction.
export async function rollbackThrough(name: string) {
  const result = await query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM pgmigrations
    WHERE id >= (SELECT id FROM pgmigrations WHERE name = $1)`, [name]);
  const count = result.rows[0]?.count;
  if (!count) throw new Error(`Migration not applied: ${name}`);
  return promisify(execFile)(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "down", String(count),
    "--single-transaction", "-m", "database/migrations", "--database-url-var", "DATABASE_URL",
  ], { cwd: fileURLToPath(new URL("../../../", import.meta.url)) });
}

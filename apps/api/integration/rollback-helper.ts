import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { query } from "../src/database/connection.js";

// Keep protected rollback tests valid as newer migrations are added. The CLI
// takes a count, never a migration filename. All downs share one transaction.
//
// NOTE: We use ROW_NUMBER() ordered by id rather than `id >= target_id` because
// the pgmigrations.id column may have non-sequential values (gaps in the
// auto-increment sequence) when migrations were applied across different DB
// instances or runs. Using id-comparison in that case overcounts rows.
export async function rollbackThrough(name: string) {
  // Count migrations at or after `name` by ordinal position, not by id value.
  // Using id-comparison breaks when the pgmigrations.id sequence has gaps
  // (e.g. migrations applied in a different DB context get non-consecutive ids).
  const result = await query<{ count: number }>(`
    SELECT (total_count - target_pos + 1)::int AS count
    FROM (
      SELECT
        name,
        COUNT(*) OVER ()                AS total_count,
        ROW_NUMBER() OVER (ORDER BY id) AS target_pos
      FROM pgmigrations
    ) t
    WHERE name = $1`, [name]);
  const count = result.rows[0]?.count;
  if (!count) throw new Error(`Migration not applied: ${name}`);
  return promisify(execFile)(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "down", String(count),
    "--single-transaction", "-m", "database/migrations", "--database-url-var", "DATABASE_URL",
  ], { cwd: fileURLToPath(new URL("../../../", import.meta.url)) });
}

require("dotenv/config");
const { Pool } = require("pg");
const { seedInitialCatalog } = require("./001_initial_catalog");

async function run() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await seedInitialCatalog(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run()
  .then(() => console.log("Initial catalog seed completed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

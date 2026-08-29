import "dotenv/config";
import { buildApp } from "./app.js";
import { closeDatabaseConnection } from "./database/connection.js";

const app = buildApp();
const port = Number(process.env.API_PORT ?? 3333);

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await closeDatabaseConnection();
    process.exit(0);
  });
}

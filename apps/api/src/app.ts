import Fastify from "fastify";
import { healthResponseSchema } from "@contatocerto/shared";
import { checkDatabaseConnection } from "./database/connection.js";

type AppDependencies = {
  checkDatabase?: () => Promise<void>;
};

export function buildApp({ checkDatabase = checkDatabaseConnection }: AppDependencies = {}) {
  const app = Fastify({ logger: true });

  app.get("/health", async () => healthResponseSchema.parse({ status: "ok" }));

  app.get("/health/db", async (_request, reply) => {
    try {
      await checkDatabase();
      return { status: "ok", database: "connected" };
    } catch (error) {
      app.log.error(error, "Database health check failed");
      return reply.code(503).send({ status: "error", database: "unavailable" });
    }
  });

  return app;
}

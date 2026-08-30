import Fastify from "fastify";
import { healthResponseSchema } from "@contatocerto/shared";
import { checkDatabaseConnection } from "./database/connection.js";
import { professionalsRoutes } from "./modules/professionals/professionals.routes.js";
import type { ProfessionalsRepository } from "./modules/professionals/professionals.types.js";

type AppDependencies = {
  checkDatabase?: () => Promise<void>;
  professionalsRepository?: ProfessionalsRepository;
  internalApiKey?: string;
};

export function buildApp({
  checkDatabase = checkDatabaseConnection,
  professionalsRepository,
  internalApiKey,
}: AppDependencies = {}) {
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

  app.register(professionalsRoutes, {
    prefix: "/internal/professionals",
    repository: professionalsRepository,
    internalApiKey,
  });

  return app;
}

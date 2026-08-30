import Fastify from "fastify";
import { healthResponseSchema } from "@contatocerto/shared";
import { checkDatabaseConnection } from "./database/connection.js";
import { professionalsRoutes } from "./modules/professionals/professionals.routes.js";
import type { ProfessionalsRepository } from "./modules/professionals/professionals.types.js";
import { catalogRoutes } from "./modules/catalog/catalog.routes.js";
import type { CatalogRepository } from "./modules/catalog/catalog.types.js";
import { professionalServicesRoutes } from "./modules/professional-services/professional-services.routes.js";
import type { ProfessionalServicesRepository } from "./modules/professional-services/professional-services.types.js";

type AppDependencies = {
  checkDatabase?: () => Promise<void>;
  professionalsRepository?: ProfessionalsRepository;
  catalogRepository?: CatalogRepository;
  professionalServicesRepository?: ProfessionalServicesRepository;
  internalApiKey?: string;
};

export function buildApp({
  checkDatabase = checkDatabaseConnection,
  professionalsRepository,
  internalApiKey,
  catalogRepository,
  professionalServicesRepository,
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

  app.register(catalogRoutes, {
    prefix: "/internal/catalog",
    repository: catalogRepository,
    internalApiKey,
  });

  app.register(professionalServicesRoutes, {
    prefix: "/internal/professionals",
    repository: professionalServicesRepository,
    internalApiKey,
  });

  return app;
}

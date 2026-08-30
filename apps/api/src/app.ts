import Fastify from "fastify";
import { healthResponseSchema } from "@contatocerto/shared";
import { checkDatabaseConnection } from "./database/connection.js";
import { professionalsRoutes } from "./modules/professionals/professionals.routes.js";
import type { ProfessionalsRepository } from "./modules/professionals/professionals.types.js";
import { catalogRoutes } from "./modules/catalog/catalog.routes.js";
import type { CatalogRepository } from "./modules/catalog/catalog.types.js";
import { professionalServicesRoutes } from "./modules/professional-services/professional-services.routes.js";
import type { ProfessionalServicesRepository } from "./modules/professional-services/professional-services.types.js";
import { serviceAreasRoutes } from "./modules/service-areas/service-areas.routes.js";
import type { ServiceAreasRepository } from "./modules/service-areas/service-areas.types.js";
import { matchingRoutes } from "./modules/matching/matching.routes.js";
import type { MatchingRepository } from "./modules/matching/matching.types.js";
import { serviceResolutionRoutes } from "./modules/service-resolution/service-resolution.routes.js";
import type { ServiceResolutionRepository } from "./modules/service-resolution/service-resolution.types.js";

type AppDependencies = {
  checkDatabase?: () => Promise<void>;
  professionalsRepository?: ProfessionalsRepository;
  catalogRepository?: CatalogRepository;
  professionalServicesRepository?: ProfessionalServicesRepository;
  serviceAreasRepository?: ServiceAreasRepository;
  matchingRepository?: MatchingRepository;
  serviceResolutionRepository?: ServiceResolutionRepository;
  internalApiKey?: string;
};

export function buildApp({
  checkDatabase = checkDatabaseConnection,
  professionalsRepository,
  internalApiKey,
  catalogRepository,
  professionalServicesRepository,
  serviceAreasRepository,
  matchingRepository,
  serviceResolutionRepository,
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

  app.register(serviceAreasRoutes, {
    prefix: "/internal/professionals",
    repository: serviceAreasRepository,
    internalApiKey,
  });

  app.register(matchingRoutes, { prefix: "/internal/matching", repository: matchingRepository, internalApiKey });
  app.register(serviceResolutionRoutes, { prefix: "/internal/service-resolution", repository: serviceResolutionRepository, internalApiKey });

  return app;
}

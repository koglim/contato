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
import { PostgresMatchingRepository } from "./modules/matching/matching.repository.js";
import type { MatchingRepository } from "./modules/matching/matching.types.js";
import { serviceResolutionRoutes } from "./modules/service-resolution/service-resolution.routes.js";
import { PostgresServiceResolutionRepository } from "./modules/service-resolution/service-resolution.repository.js";
import type { ServiceResolutionRepository } from "./modules/service-resolution/service-resolution.types.js";
import { locationResolutionRoutes } from "./modules/location-resolution/location-resolution.routes.js";
import { readLocationResolutionConfig } from "./config/location-resolution.js";
import { OpenRouteServiceGeocodingProvider } from "./modules/location-resolution/providers/openrouteservice-geocoding.provider.js";
import { DeterministicLocationResolutionService } from "./modules/location-resolution/location-resolution.service.js";
import type { GeocodingProvider, LocationResolutionService } from "./modules/location-resolution/location-resolution.types.js";
import { searchOrchestrationRoutes } from "./modules/search-orchestration/search-orchestration.routes.js";
import { DeterministicSearchOrchestrator } from "./modules/search-orchestration/search-orchestration.service.js";
import type { SearchOrchestrationService } from "./modules/search-orchestration/search-orchestration.types.js";

type AppDependencies = {
  checkDatabase?: () => Promise<void>;
  professionalsRepository?: ProfessionalsRepository;
  catalogRepository?: CatalogRepository;
  professionalServicesRepository?: ProfessionalServicesRepository;
  serviceAreasRepository?: ServiceAreasRepository;
  matchingRepository?: MatchingRepository;
  serviceResolutionRepository?: ServiceResolutionRepository;
  geocodingProvider?: GeocodingProvider;
  locationResolutionService?: LocationResolutionService;
  searchOrchestrationService?: SearchOrchestrationService;
  internalApiKey?: string;
};

function createLazyLocationResolutionService(provider?: GeocodingProvider): LocationResolutionService {
  let service: LocationResolutionService | undefined;
  return {
    resolve(input) {
      service ??= new DeterministicLocationResolutionService(
        provider ?? new OpenRouteServiceGeocodingProvider(),
        readLocationResolutionConfig(),
      );
      return service.resolve(input);
    },
  };
}

export function buildApp({
  checkDatabase = checkDatabaseConnection,
  professionalsRepository,
  internalApiKey,
  catalogRepository,
  professionalServicesRepository,
  serviceAreasRepository,
  matchingRepository,
  serviceResolutionRepository,
  geocodingProvider,
  locationResolutionService,
  searchOrchestrationService,
}: AppDependencies = {}) {
  const app = Fastify({ logger: true });
  const resolvedServiceResolutionRepository = serviceResolutionRepository ?? new PostgresServiceResolutionRepository();
  const resolvedMatchingRepository = matchingRepository ?? new PostgresMatchingRepository();
  const resolvedLocationResolutionService = locationResolutionService ?? createLazyLocationResolutionService(geocodingProvider);
  const resolvedSearchOrchestrationService = searchOrchestrationService ?? new DeterministicSearchOrchestrator(
    resolvedServiceResolutionRepository,
    resolvedLocationResolutionService,
    resolvedMatchingRepository,
  );

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

  app.register(matchingRoutes, { prefix: "/internal/matching", repository: resolvedMatchingRepository, internalApiKey });
  app.register(serviceResolutionRoutes, { prefix: "/internal/service-resolution", repository: resolvedServiceResolutionRepository, internalApiKey });
  app.register(locationResolutionRoutes, { prefix: "/internal/location-resolution", service: resolvedLocationResolutionService, internalApiKey });
  app.register(searchOrchestrationRoutes, { prefix: "/internal/search", service: resolvedSearchOrchestrationService, internalApiKey });

  return app;
}

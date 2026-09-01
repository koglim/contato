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
import { messageInterpretationRoutes } from "./modules/message-interpretation/message-interpretation.routes.js";
import { DeterministicMessageInterpreter } from "./modules/message-interpretation/message-interpretation.service.js";
import type { MessageInterpretationService } from "./modules/message-interpretation/message-interpretation.types.js";
import { messageSearchRoutes } from "./modules/message-search/message-search.routes.js";
import { HybridMessageSearchService } from "./modules/message-search/message-search.service.js";
import {
  readMessageInterpretationFallbackConfig,
  type MessageInterpretationFallbackConfig,
} from "./config/message-interpretation-fallback.js";
import type { MessageLocationFallbackProvider } from "./modules/message-interpretation-fallback/message-location-fallback.types.js";
import { OpenAIMessageLocationFallbackProvider } from "./modules/message-interpretation-fallback/openai-message-location-fallback.provider.js";
import type { MessageSearchService } from "./modules/message-search/message-search.types.js";
import { readSearchConversationConfig, type SearchConversationConfig } from "./config/search-conversation.js";
import { searchConversationRoutes } from "./modules/search-conversations/search-conversation.routes.js";
import { PostgresSearchConversationRepository } from "./modules/search-conversations/search-conversation.repository.js";
import { DefaultSearchConversationService } from "./modules/search-conversations/search-conversation.service.js";
import type {
  SearchConversationRepository,
  SearchConversationService,
} from "./modules/search-conversations/search-conversation.types.js";
import { PostgresCustomerRepository, type CustomerRepository } from "./modules/customers/customer.repository.js";
import { customerSearchRoutes } from "./modules/customer-search/customer-search.routes.js";
import { DefaultCustomerSearchRouter } from "./modules/customer-search/customer-search.service.js";
import type { CustomerSearchRouter } from "./modules/customer-search/customer-search.types.js";
import { channelInboxRoutes } from "./modules/channel-inbox/channel-inbox.routes.js";
import { DefaultChannelInboxService } from "./modules/channel-inbox/channel-inbox.service.js";
import { PostgresChannelInboundMessageRepository } from "./modules/channel-inbox/channel-inbox.repository.js";
import type { ChannelInboxService, ChannelInboundMessageRepository } from "./modules/channel-inbox/channel-inbox.types.js";
import { readChannelInboxConfig, type ChannelInboxConfig } from "./config/channel-inbox.js";

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
  messageInterpretationService?: MessageInterpretationService;
  messageLocationFallbackProvider?: MessageLocationFallbackProvider;
  messageInterpretationFallbackConfig?: MessageInterpretationFallbackConfig;
  messageSearchService?: MessageSearchService;
  searchConversationRepository?: SearchConversationRepository;
  searchConversationService?: SearchConversationService;
  searchConversationConfig?: SearchConversationConfig;
  customerRepository?: CustomerRepository;
  customerSearchRouter?: CustomerSearchRouter;
  channelInboundMessageRepository?: ChannelInboundMessageRepository;
  channelInboxService?: ChannelInboxService;
  channelInboxConfig?: ChannelInboxConfig;
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

function createLazyMessageLocationFallbackProvider(
  config: MessageInterpretationFallbackConfig,
): MessageLocationFallbackProvider {
  let provider: MessageLocationFallbackProvider | undefined;
  return {
    name: "openai",
    resolve(input) {
      provider ??= new OpenAIMessageLocationFallbackProvider(config);
      return provider.resolve(input);
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
  messageInterpretationService,
  messageLocationFallbackProvider,
  messageInterpretationFallbackConfig,
  messageSearchService,
  searchConversationRepository,
  searchConversationService,
  searchConversationConfig,
  customerRepository,
  customerSearchRouter,
  channelInboundMessageRepository,
  channelInboxService,
  channelInboxConfig,
}: AppDependencies = {}) {
  const app = Fastify({ logger: true });
  const resolvedMessageInterpretationFallbackConfig =
    messageInterpretationFallbackConfig ?? readMessageInterpretationFallbackConfig();
  const resolvedServiceResolutionRepository = serviceResolutionRepository ?? new PostgresServiceResolutionRepository();
  const resolvedMatchingRepository = matchingRepository ?? new PostgresMatchingRepository();
  const resolvedLocationResolutionService = locationResolutionService ?? createLazyLocationResolutionService(geocodingProvider);
  const resolvedSearchOrchestrationService = searchOrchestrationService ?? new DeterministicSearchOrchestrator(
    resolvedServiceResolutionRepository,
    resolvedLocationResolutionService,
    resolvedMatchingRepository,
  );
  const resolvedMessageInterpretationService = messageInterpretationService ?? new DeterministicMessageInterpreter();
  const resolvedMessageLocationFallbackProvider = messageLocationFallbackProvider
    ?? createLazyMessageLocationFallbackProvider(resolvedMessageInterpretationFallbackConfig);
  const resolvedMessageSearchService = messageSearchService ?? new HybridMessageSearchService(
      resolvedMessageInterpretationService,
      resolvedSearchOrchestrationService,
      resolvedMessageLocationFallbackProvider,
      {
        enabled: resolvedMessageInterpretationFallbackConfig.enabled,
        onError: ({ kind, durationMs }) => app.log.warn({
          provider: resolvedMessageLocationFallbackProvider.name,
          model: resolvedMessageInterpretationFallbackConfig.model,
          fallback_status: "error",
          error_kind: kind,
          duration_ms: durationMs,
        }, "Message location fallback failed"),
      },
  );
  const resolvedSearchConversationConfig = searchConversationConfig ?? readSearchConversationConfig();
  const resolvedSearchConversationRepository = searchConversationRepository ?? new PostgresSearchConversationRepository();
  const resolvedSearchConversationService = searchConversationService ?? new DefaultSearchConversationService(
    resolvedSearchConversationRepository,
    resolvedMessageSearchService,
    resolvedSearchOrchestrationService,
    resolvedSearchConversationConfig,
  );
  const resolvedCustomerSearchRouter = customerSearchRouter ?? new DefaultCustomerSearchRouter(
    customerRepository ?? new PostgresCustomerRepository(),
    resolvedSearchConversationRepository,
    resolvedSearchConversationService,
  );
  const resolvedChannelInboxService = channelInboxService ?? new DefaultChannelInboxService(
    channelInboundMessageRepository ?? new PostgresChannelInboundMessageRepository(),
    resolvedCustomerSearchRouter,
    channelInboxConfig ?? readChannelInboxConfig(),
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
  app.register(messageInterpretationRoutes, { prefix: "/internal/message-interpretation", service: resolvedMessageInterpretationService, internalApiKey });
  app.register(messageSearchRoutes, { prefix: "/internal/search", service: resolvedMessageSearchService, internalApiKey });
  app.register(searchConversationRoutes, { prefix: "/internal/search/conversations", service: resolvedSearchConversationService, internalApiKey });
  app.register(customerSearchRoutes, { prefix: "/internal/customer-search", router: resolvedCustomerSearchRouter, internalApiKey });
  app.register(channelInboxRoutes, { prefix: "/internal/channel/inbound", service: resolvedChannelInboxService, internalApiKey });

  return app;
}

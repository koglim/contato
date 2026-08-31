import type { FastifyPluginAsync } from "fastify";
import { searchOrchestrationRequestSchema, searchOrchestrationResponseSchema } from "@contatocerto/shared";
import { createInternalKeyGuard } from "../internal/internal-auth.js";
import { validationError } from "../internal/validation.js";
import { GeocodingProviderError } from "../location-resolution/location-resolution.types.js";
import type { SearchOrchestrationService } from "./search-orchestration.types.js";

type SearchOrchestrationRoutesOptions = { internalApiKey?: string; service: SearchOrchestrationService };

export const searchOrchestrationRoutes: FastifyPluginAsync<SearchOrchestrationRoutesOptions> = async (app, options) => {
  const requireInternalKey = createInternalKeyGuard(options.internalApiKey ?? process.env.INTERNAL_API_KEY);
  app.post("/orchestrate", { preHandler: requireInternalKey }, async (request, reply) => {
    const body = searchOrchestrationRequestSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    try {
      const outcome = await options.service.orchestrate(body.data);
      if (outcome.kind === "service_unavailable") return reply.code(409).send({ error: "service_unavailable" });
      return reply.send(searchOrchestrationResponseSchema.parse(outcome.response));
    } catch (error) {
      if (error instanceof GeocodingProviderError) {
        const status = error.kind === "rate_limited" ? 429 : error.kind === "unavailable" ? 503 : 502;
        const code = error.kind === "rate_limited" ? "geocoding_rate_limited" : error.kind === "unavailable" ? "geocoding_unavailable" : "geocoding_provider_error";
        return reply.code(status).send({ error: code });
      }
      app.log.error(error, "Search orchestration failed");
      return reply.code(500).send({ error: "internal_error" });
    }
  });
};

import type { FastifyPluginAsync } from "fastify";
import {
  continueSearchConversationParamsSchema,
  continueSearchConversationRequestSchema,
  continueSearchConversationResponseSchema,
  startSearchConversationRequestSchema,
  startSearchConversationResponseSchema,
} from "@contatocerto/shared";
import { createInternalKeyGuard } from "../internal/internal-auth.js";
import { validationError } from "../internal/validation.js";
import { GeocodingProviderError } from "../location-resolution/location-resolution.types.js";
import type { SearchConversationService } from "./search-conversation.types.js";

type SearchConversationRoutesOptions = {
  internalApiKey?: string;
  service: SearchConversationService;
};

function geocodingError(error: GeocodingProviderError) {
  if (error.kind === "rate_limited") return { status: 429, code: "geocoding_rate_limited" } as const;
  if (error.kind === "unavailable") return { status: 503, code: "geocoding_unavailable" } as const;
  return { status: 502, code: "geocoding_provider_error" } as const;
}

export const searchConversationRoutes: FastifyPluginAsync<SearchConversationRoutesOptions> = async (app, options) => {
  const requireInternalKey = createInternalKeyGuard(options.internalApiKey ?? process.env.INTERNAL_API_KEY);

  app.post("/", { preHandler: requireInternalKey }, async (request, reply) => {
    const body = startSearchConversationRequestSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);

    try {
      const outcome = await options.service.start(body.data);
      if (outcome.kind === "service_unavailable") return reply.code(409).send({ error: "service_unavailable" });
      return reply.send(startSearchConversationResponseSchema.parse(outcome.response));
    } catch (error) {
      if (error instanceof GeocodingProviderError) {
        const mapped = geocodingError(error);
        return reply.code(mapped.status).send({ error: mapped.code });
      }
      app.log.error(error, "Failed to start search conversation");
      return reply.code(500).send({ error: "internal_error" });
    }
  });

  app.post("/:conversationId/messages", { preHandler: requireInternalKey }, async (request, reply) => {
    const params = continueSearchConversationParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = continueSearchConversationRequestSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);

    try {
      const outcome = await options.service.continueWithLocation(params.data.conversationId, body.data);
      if (outcome.kind === "conversation_not_found") return reply.code(404).send({ error: "conversation_not_found" });
      if (outcome.kind === "conversation_expired") return reply.code(410).send({ error: "conversation_expired" });
      if (outcome.kind === "conversation_not_active") return reply.code(409).send({ error: "conversation_not_active" });
      if (outcome.kind === "conversation_processing") return reply.code(409).send({ error: "conversation_processing" });
      if (outcome.kind === "service_unavailable") return reply.code(409).send({ error: "service_unavailable" });
      return reply.send(continueSearchConversationResponseSchema.parse(outcome.response));
    } catch (error) {
      if (error instanceof GeocodingProviderError) {
        const mapped = geocodingError(error);
        return reply.code(mapped.status).send({ error: mapped.code });
      }
      app.log.error(error, "Failed to continue search conversation");
      return reply.code(500).send({ error: "internal_error" });
    }
  });
};

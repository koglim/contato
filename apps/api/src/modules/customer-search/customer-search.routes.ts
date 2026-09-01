import type { FastifyPluginAsync } from "fastify";
import {
  customerSearchMessageRequestSchema,
  customerSearchMessageResponseSchema,
} from "@contatocerto/shared";
import { createInternalKeyGuard } from "../internal/internal-auth.js";
import { validationError } from "../internal/validation.js";
import { GeocodingProviderError } from "../location-resolution/location-resolution.types.js";
import type { CustomerSearchRouter } from "./customer-search.types.js";

type CustomerSearchRoutesOptions = { internalApiKey?: string; router: CustomerSearchRouter };

function geocodingError(error: GeocodingProviderError) {
  if (error.kind === "rate_limited") return { status: 429, code: "geocoding_rate_limited" } as const;
  if (error.kind === "unavailable") return { status: 503, code: "geocoding_unavailable" } as const;
  return { status: 502, code: "geocoding_provider_error" } as const;
}

export const customerSearchRoutes: FastifyPluginAsync<CustomerSearchRoutesOptions> = async (app, options) => {
  const requireInternalKey = createInternalKeyGuard(options.internalApiKey ?? process.env.INTERNAL_API_KEY);

  app.post("/messages", { preHandler: requireInternalKey }, async (request, reply) => {
    const body = customerSearchMessageRequestSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);

    try {
      const outcome = await options.router.route(body.data);
      if (outcome.kind === "customer_conversation_conflict") return reply.code(409).send({ error: outcome.kind });
      if (outcome.kind === "conversation_processing") return reply.code(409).send({ error: outcome.kind });
      if (outcome.kind === "service_unavailable") return reply.code(409).send({ error: outcome.kind });

      const conversation = outcome.response.conversation;
      app.log.info({
        customer_id: outcome.response.customer_id,
        route: outcome.response.route,
        conversation_id: conversation.conversation_id,
        result_status: conversation.result.status,
      }, "Customer search routed");
      return reply.send(customerSearchMessageResponseSchema.parse(outcome.response));
    } catch (error) {
      if (error instanceof GeocodingProviderError) {
        const mapped = geocodingError(error);
        return reply.code(mapped.status).send({ error: mapped.code });
      }
      app.log.error(error, "Failed to route customer search message");
      return reply.code(500).send({ error: "internal_error" });
    }
  });
};

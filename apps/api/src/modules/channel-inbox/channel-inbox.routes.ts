import type { FastifyPluginAsync } from "fastify";
import {
  channelInboundMessageRequestSchema,
} from "@contatocerto/shared";
import { createInternalKeyGuard } from "../internal/internal-auth.js";
import { validationError } from "../internal/validation.js";
import { GeocodingProviderError } from "../location-resolution/location-resolution.types.js";
import { CustomerPhoneIdentityCollisionError } from "../customers/customer.repository.js";
import type { ChannelInboxService } from "./channel-inbox.types.js";

type ChannelInboxRoutesOptions = { internalApiKey?: string; service: ChannelInboxService };

function geocodingError(error: GeocodingProviderError) {
  if (error.kind === "rate_limited") return { status: 429, code: "geocoding_rate_limited" } as const;
  if (error.kind === "unavailable") return { status: 503, code: "geocoding_unavailable" } as const;
  return { status: 502, code: "geocoding_provider_error" } as const;
}

export const channelInboxRoutes: FastifyPluginAsync<ChannelInboxRoutesOptions> = async (app, options) => {
  const requireInternalKey = createInternalKeyGuard(options.internalApiKey ?? process.env.INTERNAL_API_KEY);

  app.post("/messages", { preHandler: requireInternalKey }, async (request, reply) => {
    const body = channelInboundMessageRequestSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);

    try {
      const outcome = await options.service.receive(body.data);
      if (outcome.kind === "channel_message_processing") return reply.code(409).send({ error: outcome.kind });
      if (outcome.kind === "channel_message_payload_conflict") return reply.code(409).send({ error: outcome.kind });
      if (outcome.kind === "channel_message_result_invalid") return reply.code(500).send({ error: outcome.kind });
      if (outcome.kind === "customer_conversation_conflict") return reply.code(409).send({ error: outcome.kind });
      if (outcome.kind === "customer_phone_identity_collision") return reply.code(409).send({ error: outcome.kind });
      if (outcome.kind === "conversation_processing") return reply.code(409).send({ error: outcome.kind });
      if (outcome.kind === "service_unavailable") return reply.code(409).send({ error: outcome.kind });
      if (outcome.kind === "selection_idempotency_key_required") return reply.code(409).send({ error: outcome.kind });
      if (outcome.kind === "selection_show_more_pending") return reply.code(409).send({ error: outcome.kind });

      app.log.info({
        inbound_message_id: outcome.response.message_id,
        provider: body.data.provider,
        duplicate: outcome.response.duplicate,
        status: "processed",
      }, "Channel inbound message processed");
      return reply.send(outcome.response);
    } catch (error) {
      if (error instanceof CustomerPhoneIdentityCollisionError) {
        return reply.code(409).send({ error: "customer_phone_identity_collision" });
      }
      if (error instanceof GeocodingProviderError) {
        const mapped = geocodingError(error);
        return reply.code(mapped.status).send({ error: mapped.code });
      }
      app.log.error({ code: "internal_error" }, "Failed to process channel inbound message");
      return reply.code(500).send({ error: "internal_error" });
    }
  });
};

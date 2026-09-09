import type { FastifyPluginAsync } from "fastify";
import {
  channelOutboundMessageClaimResponseSchema,
  channelOutboundMessageMutationResponseSchema,
  channelOutboundMessageParamsSchema,
  markChannelOutboundMessageFailedSchema,
  markChannelOutboundMessageSentSchema,
} from "@contatocerto/shared";
import { createInternalKeyGuard } from "../internal/internal-auth.js";
import { validationError } from "../internal/validation.js";
import type { ChannelOutboundService } from "./channel-outbox.types.js";

type ChannelOutboundRoutesOptions = { internalApiKey?: string; service: ChannelOutboundService };

function routeError(reply: { code(status: number): { send(payload: unknown): unknown } }, kind: string) {
  if (kind === "outbound_message_not_found") return reply.code(404).send({ error: kind });
  return reply.code(409).send({ error: kind });
}

export const channelOutboundRoutes: FastifyPluginAsync<ChannelOutboundRoutesOptions> = async (app, options) => {
  // Never serialize PostgreSQL detail/context or validation input containing PII.
  app.setErrorHandler((_error, _request, reply) => {
    app.log.error({ code: "internal_error" }, "Outbound operation failed");
    return reply.code(500).send({ error: "internal_error" });
  });
  const requireInternalKey = createInternalKeyGuard(options.internalApiKey ?? process.env.INTERNAL_API_KEY);

  app.post("/next/claim", { preHandler: requireInternalKey }, async (_request, reply) => {
    const outcome = await options.service.claimNextPending();
    if (outcome.kind === "outbound_queue_empty") return reply.code(204).send();
    if (outcome.kind !== "response") return routeError(reply, outcome.kind);
    return reply.send(channelOutboundMessageClaimResponseSchema.parse(outcome.response));
  });

  app.post("/:outboundId/claim", { preHandler: requireInternalKey }, async (request, reply) => {
    const params = channelOutboundMessageParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const outcome = await options.service.claim(params.data.outboundId);
    if (outcome.kind !== "response") return routeError(reply, outcome.kind);
    return reply.send(channelOutboundMessageClaimResponseSchema.parse(outcome.response));
  });

  app.post("/:outboundId/sent", { preHandler: requireInternalKey }, async (request, reply) => {
    const params = channelOutboundMessageParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = markChannelOutboundMessageSentSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    const outcome = await options.service.markSent(params.data.outboundId, body.data);
    if (outcome.kind !== "response") return routeError(reply, outcome.kind);
    return reply.send(channelOutboundMessageMutationResponseSchema.parse(outcome.response));
  });

  app.post("/:outboundId/failed", { preHandler: requireInternalKey }, async (request, reply) => {
    const params = channelOutboundMessageParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = markChannelOutboundMessageFailedSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    const outcome = await options.service.markFailed(params.data.outboundId, body.data);
    if (outcome.kind !== "response") return routeError(reply, outcome.kind);
    return reply.send(channelOutboundMessageMutationResponseSchema.parse(outcome.response));
  });
};

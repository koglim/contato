import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import {
  extendProfessionalSubscriptionSchema,
  grantProfessionalSubscriptionSchema,
  reactivateProfessionalSubscriptionSchema,
} from "@contatocerto/shared";
import { createInternalKeyGuard } from "../internal/internal-auth.js";
import { ProfessionalSubscriptionService } from "./professional-subscription.service.js";

type SubscriptionService = Pick<
  ProfessionalSubscriptionService,
  "getEntitlementSnapshot" | "grant" | "extend" | "revoke" | "reactivate"
>;

type Options = {
  internalApiKey?: string;
  service?: SubscriptionService;
};

const professionalParams = z
  .object({
    professionalId: z.string().uuid(),
  })
  .strict();

const emptyBodySchema = z.union([z.undefined(), z.null(), z.object({}).strict()]);

function domainError(reply: FastifyReply, error: unknown) {
  const code = error instanceof Error ? error.message : "internal_error";
  const statuses: Record<string, number> = {
    professional_not_found: 404,
    subscription_not_found: 404,
    subscription_already_exists: 409,
    plan_not_found: 404,
    plan_inactive: 409,
    invalid_extension_period: 400,
    invalid_request: 400,
  };
  const status = statuses[code] ?? 500;
  return reply.code(status).send({ error: status === 500 ? "internal_error" : code });
}

export const professionalSubscriptionsRoutes: FastifyPluginAsync<Options> = async (app, options) => {
  const internalApiKey = options.internalApiKey ?? process.env.INTERNAL_API_KEY;
  const guard = createInternalKeyGuard(internalApiKey);
  const service = options.service ?? new ProfessionalSubscriptionService();

  app.get("/:professionalId", { preHandler: guard }, async (request, reply) => {
    const params = professionalParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });

    try {
      return await service.getEntitlementSnapshot(params.data.professionalId);
    } catch (error) {
      return domainError(reply, error);
    }
  });

  app.post("/:professionalId/grant", { preHandler: guard }, async (request, reply) => {
    const params = professionalParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });

    const body = grantProfessionalSubscriptionSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });

    try {
      const snapshot = await service.grant(params.data.professionalId, body.data);
      return reply.code(200).send(snapshot);
    } catch (error) {
      return domainError(reply, error);
    }
  });

  app.post("/:professionalId/extend", { preHandler: guard }, async (request, reply) => {
    const params = professionalParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });

    const body = extendProfessionalSubscriptionSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });

    try {
      const snapshot = await service.extend(params.data.professionalId, body.data);
      return reply.code(200).send(snapshot);
    } catch (error) {
      return domainError(reply, error);
    }
  });

  app.post("/:professionalId/revoke", { preHandler: guard }, async (request, reply) => {
    const params = professionalParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });

    const body = emptyBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });

    try {
      const snapshot = await service.revoke(params.data.professionalId);
      return reply.code(200).send(snapshot);
    } catch (error) {
      return domainError(reply, error);
    }
  });

  app.post("/:professionalId/reactivate", { preHandler: guard }, async (request, reply) => {
    const params = professionalParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });

    const body = reactivateProfessionalSubscriptionSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });

    try {
      const snapshot = await service.reactivate(params.data.professionalId, body.data);
      return reply.code(200).send(snapshot);
    } catch (error) {
      return domainError(reply, error);
    }
  });
};

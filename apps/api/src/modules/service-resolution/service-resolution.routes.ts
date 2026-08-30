import type { FastifyPluginAsync } from "fastify";
import { serviceResolutionRequestSchema, serviceResolutionResponseSchema } from "@contatocerto/shared";
import { createInternalKeyGuard } from "../internal/internal-auth.js";
import { validationError } from "../internal/validation.js";
import { PostgresServiceResolutionRepository } from "./service-resolution.repository.js";
import type { ServiceResolutionRepository } from "./service-resolution.types.js";

type ServiceResolutionRoutesOptions = { internalApiKey?: string; repository?: ServiceResolutionRepository };

export const serviceResolutionRoutes: FastifyPluginAsync<ServiceResolutionRoutesOptions> = async (app, options) => {
  const repository = options.repository ?? new PostgresServiceResolutionRepository();
  const requireInternalKey = createInternalKeyGuard(options.internalApiKey ?? process.env.INTERNAL_API_KEY);
  app.post("/resolve", { preHandler: requireInternalKey }, async (request, reply) => {
    const body = serviceResolutionRequestSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    try {
      return reply.send(serviceResolutionResponseSchema.parse(await repository.resolve(body.data)));
    } catch (error) {
      app.log.error(error, "Failed to resolve service");
      return reply.code(500).send({ error: "internal_error" });
    }
  });
};

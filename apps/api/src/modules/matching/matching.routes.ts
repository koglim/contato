import type { FastifyPluginAsync } from "fastify";
import { matchingSearchRequestSchema, matchingSearchResponseSchema } from "@contatocerto/shared";
import { createInternalKeyGuard } from "../internal/internal-auth.js";
import { validationError } from "../internal/validation.js";
import { PostgresMatchingRepository } from "./matching.repository.js";
import type { MatchingRepository } from "./matching.types.js";

type MatchingRoutesOptions = { internalApiKey?: string; repository?: MatchingRepository };

export const matchingRoutes: FastifyPluginAsync<MatchingRoutesOptions> = async (app, options) => {
  const repository = options.repository ?? new PostgresMatchingRepository();
  const requireInternalKey = createInternalKeyGuard(options.internalApiKey ?? process.env.INTERNAL_API_KEY);
  app.post("/search", { preHandler: requireInternalKey }, async (request, reply) => {
    const body = matchingSearchRequestSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    try {
      const outcome = await repository.search(body.data);
      if (outcome.kind === "service_not_found") return reply.code(404).send({ error: "service_not_found" });
      if (outcome.kind === "service_inactive") return reply.code(409).send({ error: "service_inactive" });
      return reply.send(matchingSearchResponseSchema.parse(outcome.response));
    } catch (error) {
      app.log.error(error, "Failed to match professionals");
      return reply.code(500).send({ error: "internal_error" });
    }
  });
};

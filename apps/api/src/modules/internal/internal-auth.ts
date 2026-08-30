import type { FastifyReply, FastifyRequest } from "fastify";

export function unauthorized(reply: FastifyReply) {
  return reply.code(401).send({ error: "unauthorized" });
}

export function createInternalKeyGuard(internalApiKey: string | undefined) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const providedKey = request.headers["x-internal-key"];

    if (!internalApiKey || typeof providedKey !== "string" || providedKey !== internalApiKey) {
      return unauthorized(reply);
    }
  };
}

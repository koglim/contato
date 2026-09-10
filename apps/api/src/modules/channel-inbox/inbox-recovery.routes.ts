import type { FastifyPluginAsync } from "fastify";
import { inboxDispositionSchema } from "@contatocerto/shared";
import { z } from "zod";
import { createInternalKeyGuard } from "../internal/internal-auth.js";
import { validationError } from "../internal/validation.js";
import type { InboxRecoveryService } from "./inbox-recovery.service.js";

export const inboxRecoveryRoutes: FastifyPluginAsync<{ internalApiKey?: string; service: Pick<InboxRecoveryService, "processNext" | "dispose" | "queueStatus"> }> = async (app, options) => {
  const preHandler = createInternalKeyGuard(options.internalApiKey ?? process.env.INTERNAL_API_KEY);
  app.post("/next/process", { preHandler }, async (_request, reply) => {
    const result = await options.service.processNext();
    return result ? reply.send(result) : reply.code(204).send();
  });
  app.get("/queue-status", { preHandler }, () => options.service.queueStatus());
  app.post("/:id/disposition", { preHandler }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = inboxDispositionSchema.safeParse(request.body);
    if (!params.success) return validationError(reply, params.error.issues);
    if (!body.success) return validationError(reply, body.error.issues);
    const result = await options.service.dispose(params.data.id, body.data);
    if (result.error) return reply.code(result.error === "inbound_not_found" ? 404 : 409).send({ error: result.error });
    return reply.send(result.response);
  });
};

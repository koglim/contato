import type { FastifyPluginAsync } from "fastify";
import { messageInterpretationRequestSchema, messageInterpretationResponseSchema } from "@contatocerto/shared";
import { createInternalKeyGuard } from "../internal/internal-auth.js";
import { validationError } from "../internal/validation.js";
import type { MessageInterpretationService } from "./message-interpretation.types.js";

type MessageInterpretationRoutesOptions = { internalApiKey?: string; service: MessageInterpretationService };

export const messageInterpretationRoutes: FastifyPluginAsync<MessageInterpretationRoutesOptions> = async (app, options) => {
  const requireInternalKey = createInternalKeyGuard(options.internalApiKey ?? process.env.INTERNAL_API_KEY);
  app.post("/interpret", { preHandler: requireInternalKey }, async (request, reply) => {
    const body = messageInterpretationRequestSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    try {
      return reply.send(messageInterpretationResponseSchema.parse(options.service.interpret(body.data)));
    } catch (error) {
      app.log.error(error, "Message interpretation failed");
      return reply.code(500).send({ error: "internal_error" });
    }
  });
};

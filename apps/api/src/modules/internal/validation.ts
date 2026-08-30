import type { FastifyReply } from "fastify";
import type { z } from "zod";

export function validationError(reply: FastifyReply, issues: z.core.$ZodIssue[]) {
  return reply.code(400).send({
    error: "validation_error",
    details: issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  });
}

import type { FastifyPluginAsync } from "fastify";
import {
  createProfessionalSchema,
  listProfessionalsQuerySchema,
  updateProfessionalSchema,
  updateProfessionalAvailabilitySchema,
} from "@contatocerto/shared";
import { z } from "zod";
import { createInternalKeyGuard } from "../internal/internal-auth.js";
import { validationError } from "../internal/validation.js";
import { PostgresProfessionalsRepository } from "./professionals.repository.js";
import type { ProfessionalsRepository } from "./professionals.types.js";

type ProfessionalsRoutesOptions = {
  internalApiKey?: string;
  repository?: ProfessionalsRepository;
};

const professionalIdParamsSchema = z.object({ id: z.string().uuid() });

function slugify(value: string) {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "professional";
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export const professionalsRoutes: FastifyPluginAsync<ProfessionalsRoutesOptions> = async (app, options) => {
  const repository = options.repository ?? new PostgresProfessionalsRepository();
  const internalApiKey = options.internalApiKey ?? process.env.INTERNAL_API_KEY;
  const requireInternalKey = createInternalKeyGuard(internalApiKey);

  app.post("/", { preHandler: requireInternalKey }, async (request, reply) => {
    const parsed = createProfessionalSchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(reply, parsed.error.issues);
    }

    const baseSlug = slugify(parsed.data.display_name);

    for (let suffix = 1; suffix <= 100; suffix += 1) {
      const slug = suffix === 1 ? baseSlug : `${baseSlug}-${suffix}`;

      try {
        const professional = await repository.create({ ...parsed.data, slug });
        return reply.code(201).send(professional);
      } catch (error) {
        if (isUniqueViolation(error)) {
          continue;
        }

        app.log.error(error, "Failed to create professional");
        return reply.code(500).send({ error: "internal_error" });
      }
    }

    return reply.code(409).send({ error: "professional_slug_conflict" });
  });

  app.get("/", { preHandler: requireInternalKey }, async (request, reply) => {
    const parsed = listProfessionalsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return validationError(reply, parsed.error.issues);
    }

    try {
      const result = await repository.list(parsed.data);
      return {
        items: result.items,
        pagination: {
          total: result.total,
          limit: parsed.data.limit,
          offset: parsed.data.offset,
        },
      };
    } catch (error) {
      app.log.error(error, "Failed to list professionals");
      return reply.code(500).send({ error: "internal_error" });
    }
  });

  app.get("/:id", { preHandler: requireInternalKey }, async (request, reply) => {
    const parsed = professionalIdParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return validationError(reply, parsed.error.issues);
    }

    try {
      const professional = await repository.findById(parsed.data.id);
      return professional ?? reply.code(404).send({ error: "professional_not_found" });
    } catch (error) {
      app.log.error(error, "Failed to fetch professional");
      return reply.code(500).send({ error: "internal_error" });
    }
  });

  app.patch("/:id", { preHandler: requireInternalKey }, async (request, reply) => {
    const params = professionalIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return validationError(reply, params.error.issues);
    }

    const body = updateProfessionalSchema.safeParse(request.body);
    if (!body.success) {
      return validationError(reply, body.error.issues);
    }

    try {
      const professional = await repository.update(params.data.id, body.data);
      return professional ?? reply.code(404).send({ error: "professional_not_found" });
    } catch (error) {
      app.log.error(error, "Failed to update professional");
      return reply.code(500).send({ error: "internal_error" });
    }
  });

  app.patch("/:professionalId/availability", { preHandler: requireInternalKey }, async (request, reply) => {
    const params = z.object({ professionalId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = updateProfessionalAvailabilitySchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);

    try {
      const availability = await repository.updateAvailability(params.data.professionalId, body.data.is_available_now);
      if (availability === null) return reply.code(404).send({ error: "professional_not_found" });
      if (availability === "not_active") return reply.code(409).send({ error: "professional_not_active" });
      return availability;
    } catch (error) {
      app.log.error(error, "Failed to update professional availability");
      return reply.code(500).send({ error: "internal_error" });
    }
  });
};

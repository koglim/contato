import type { FastifyPluginAsync } from "fastify";
import {
  createProfessionalServiceSchema,
  updateProfessionalServiceSchema,
  type CreateProfessionalServiceInput,
  type ProfessionalServiceResponse,
} from "@contatocerto/shared";
import { z } from "zod";
import { createInternalKeyGuard } from "../internal/internal-auth.js";
import { validationError } from "../internal/validation.js";
import { PostgresProfessionalServicesRepository } from "./professional-services.repository.js";
import type {
  ProfessionalServicesRepository,
  ProfessionalServiceUpdateRecord,
} from "./professional-services.types.js";

const professionalParamsSchema = z.object({ professionalId: z.string().uuid() });
const professionalServiceParamsSchema = professionalParamsSchema.extend({ professionalServiceId: z.string().uuid() });

type ProfessionalServicesRoutesOptions = {
  internalApiKey?: string;
  repository?: ProfessionalServicesRepository;
};

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function toUpdateRecord(input: CreateProfessionalServiceInput): ProfessionalServiceUpdateRecord {
  return {
    description: input.description ?? null,
    price_mode: input.price_mode,
    price_from_cents: input.price_from_cents ?? null,
    price_to_cents: input.price_to_cents ?? null,
    is_active: true,
  };
}

function resolveUpdate(
  current: ProfessionalServiceResponse,
  update: z.infer<typeof updateProfessionalServiceSchema>,
) {
  const priceMode = update.price_mode ?? current.price_mode;
  const finalValue = {
    service_id: current.service_id,
    description: update.description === undefined ? current.description ?? undefined : update.description ?? undefined,
    price_mode: priceMode,
    price_from_cents:
      priceMode === "quote" ? undefined : update.price_from_cents === undefined ? current.price_from_cents ?? undefined : update.price_from_cents ?? undefined,
    price_to_cents:
      priceMode === "range" ? update.price_to_cents === undefined ? current.price_to_cents ?? undefined : update.price_to_cents ?? undefined : undefined,
  };
  const parsed = createProfessionalServiceSchema.safeParse(finalValue);

  if (!parsed.success) {
    return { success: false as const, issues: parsed.error.issues };
  }

  return {
    success: true as const,
    data: {
      ...toUpdateRecord(parsed.data),
      is_active: update.is_active ?? current.is_active,
    },
  };
}

export const professionalServicesRoutes: FastifyPluginAsync<ProfessionalServicesRoutesOptions> = async (app, options) => {
  const repository = options.repository ?? new PostgresProfessionalServicesRepository();
  const requireInternalKey = createInternalKeyGuard(options.internalApiKey ?? process.env.INTERNAL_API_KEY);

  app.get("/:professionalId/services", { preHandler: requireInternalKey }, async (request, reply) => {
    const params = professionalParamsSchema.safeParse(request.params);
    if (!params.success) {
      return validationError(reply, params.error.issues);
    }

    try {
      if (!(await repository.professionalExists(params.data.professionalId))) {
        return reply.code(404).send({ error: "professional_not_found" });
      }
      return { items: await repository.listByProfessional(params.data.professionalId) };
    } catch (error) {
      app.log.error(error, "Failed to list professional services");
      return reply.code(500).send({ error: "internal_error" });
    }
  });

  app.post("/:professionalId/services", { preHandler: requireInternalKey }, async (request, reply) => {
    const params = professionalParamsSchema.safeParse(request.params);
    if (!params.success) {
      return validationError(reply, params.error.issues);
    }
    const body = createProfessionalServiceSchema.safeParse(request.body);
    if (!body.success) {
      return validationError(reply, body.error.issues);
    }

    try {
      if (!(await repository.professionalExists(params.data.professionalId))) {
        return reply.code(404).send({ error: "professional_not_found" });
      }
      const service = await repository.findService(body.data.service_id);
      if (!service) {
        return reply.code(404).send({ error: "service_not_found" });
      }
      if (!service.is_active) {
        return reply.code(409).send({ error: "service_inactive" });
      }

      const existing = await repository.findByProfessionalAndService(params.data.professionalId, body.data.service_id);
      if (existing?.is_active) {
        return reply.code(409).send({ error: "professional_service_already_exists" });
      }
      if (existing) {
        const reactivated = await repository.update(params.data.professionalId, existing.id, toUpdateRecord(body.data));
        return reply.code(200).send(reactivated);
      }

      try {
        return reply.code(201).send(await repository.create(params.data.professionalId, body.data));
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }

        const concurrent = await repository.findByProfessionalAndService(params.data.professionalId, body.data.service_id);
        if (concurrent?.is_active) {
          return reply.code(409).send({ error: "professional_service_already_exists" });
        }
        if (concurrent) {
          const reactivated = await repository.update(params.data.professionalId, concurrent.id, toUpdateRecord(body.data));
          return reply.code(200).send(reactivated);
        }
        throw error;
      }
    } catch (error) {
      app.log.error(error, "Failed to create professional service");
      return reply.code(500).send({ error: "internal_error" });
    }
  });

  app.patch("/:professionalId/services/:professionalServiceId", { preHandler: requireInternalKey }, async (request, reply) => {
    const params = professionalServiceParamsSchema.safeParse(request.params);
    if (!params.success) {
      return validationError(reply, params.error.issues);
    }
    const body = updateProfessionalServiceSchema.safeParse(request.body);
    if (!body.success) {
      return validationError(reply, body.error.issues);
    }

    try {
      const current = await repository.findById(params.data.professionalId, params.data.professionalServiceId);
      if (!current) {
        return reply.code(404).send({ error: "professional_service_not_found" });
      }

      const resolved = resolveUpdate(current, body.data);
      if (!resolved.success) {
        return validationError(reply, resolved.issues);
      }
      if (resolved.data.is_active && !current.is_active) {
        const service = await repository.findService(current.service_id);
        if (!service || !service.is_active) {
          return reply.code(409).send({ error: "service_inactive" });
        }
      }

      return reply.send(await repository.update(params.data.professionalId, current.id, resolved.data));
    } catch (error) {
      app.log.error(error, "Failed to update professional service");
      return reply.code(500).send({ error: "internal_error" });
    }
  });
};

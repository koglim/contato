import type { FastifyPluginAsync } from "fastify";
import {
  createServiceAreaSchema,
  updateServiceAreaSchema,
  type ServiceAreaResponse,
} from "@contatocerto/shared";
import { z } from "zod";
import { createInternalKeyGuard } from "../internal/internal-auth.js";
import { validationError } from "../internal/validation.js";
import { PostgresServiceAreasRepository } from "./service-areas.repository.js";
import type { ServiceAreasRepository, ServiceAreaUpdateRecord } from "./service-areas.types.js";

const professionalParamsSchema = z.object({ professionalId: z.string().uuid() });
const areaParamsSchema = professionalParamsSchema.extend({ areaId: z.string().uuid() });

type ServiceAreasRoutesOptions = {
  internalApiKey?: string;
  repository?: ServiceAreasRepository;
};

function resolveUpdate(
  current: ServiceAreaResponse,
  update: z.infer<typeof updateServiceAreaSchema>,
): ServiceAreaUpdateRecord {
  return {
    label: update.label === undefined ? current.label : update.label,
    city: update.city ?? current.city,
    state: update.state ?? current.state,
    country_code: update.country_code ?? current.country_code,
    neighborhood: update.neighborhood === undefined ? current.neighborhood : update.neighborhood,
    latitude: update.latitude ?? current.latitude,
    longitude: update.longitude ?? current.longitude,
    radius_meters: update.radius_meters ?? current.radius_meters,
    is_primary: update.is_primary ?? current.is_primary,
  };
}

export const serviceAreasRoutes: FastifyPluginAsync<ServiceAreasRoutesOptions> = async (app, options) => {
  const repository = options.repository ?? new PostgresServiceAreasRepository();
  const requireInternalKey = createInternalKeyGuard(options.internalApiKey ?? process.env.INTERNAL_API_KEY);

  app.get("/:professionalId/service-areas", { preHandler: requireInternalKey }, async (request, reply) => {
    const params = professionalParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);

    try {
      if (!(await repository.professionalExists(params.data.professionalId))) {
        return reply.code(404).send({ error: "professional_not_found" });
      }
      return { items: await repository.listByProfessional(params.data.professionalId) };
    } catch (error) {
      app.log.error(error, "Failed to list service areas");
      return reply.code(500).send({ error: "internal_error" });
    }
  });

  app.post("/:professionalId/service-areas", { preHandler: requireInternalKey }, async (request, reply) => {
    const params = professionalParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = createServiceAreaSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);

    try {
      if (!(await repository.professionalExists(params.data.professionalId))) {
        return reply.code(404).send({ error: "professional_not_found" });
      }
      return reply.code(201).send(await repository.create(params.data.professionalId, body.data));
    } catch (error) {
      app.log.error(error, "Failed to create service area");
      return reply.code(500).send({ error: "internal_error" });
    }
  });

  app.patch("/:professionalId/service-areas/:areaId", { preHandler: requireInternalKey }, async (request, reply) => {
    const params = areaParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = updateServiceAreaSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);

    try {
      const current = await repository.findById(params.data.professionalId, params.data.areaId);
      if (!current) return reply.code(404).send({ error: "service_area_not_found" });
      return reply.send(await repository.update(params.data.professionalId, params.data.areaId, resolveUpdate(current, body.data)));
    } catch (error) {
      app.log.error(error, "Failed to update service area");
      return reply.code(500).send({ error: "internal_error" });
    }
  });

  app.delete("/:professionalId/service-areas/:areaId", { preHandler: requireInternalKey }, async (request, reply) => {
    const params = areaParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);

    try {
      const deleted = await repository.delete(params.data.professionalId, params.data.areaId);
      return deleted ? reply.code(204).send() : reply.code(404).send({ error: "service_area_not_found" });
    } catch (error) {
      app.log.error(error, "Failed to delete service area");
      return reply.code(500).send({ error: "internal_error" });
    }
  });
};

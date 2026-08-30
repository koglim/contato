import type { FastifyPluginAsync } from "fastify";
import { listCatalogServicesQuerySchema } from "@contatocerto/shared";
import { createInternalKeyGuard } from "../internal/internal-auth.js";
import { validationError } from "../internal/validation.js";
import { PostgresCatalogRepository } from "./catalog.repository.js";
import type { CatalogRepository } from "./catalog.types.js";

type CatalogRoutesOptions = {
  internalApiKey?: string;
  repository?: CatalogRepository;
};

export const catalogRoutes: FastifyPluginAsync<CatalogRoutesOptions> = async (app, options) => {
  const repository = options.repository ?? new PostgresCatalogRepository();
  const requireInternalKey = createInternalKeyGuard(options.internalApiKey ?? process.env.INTERNAL_API_KEY);

  app.get("/services", { preHandler: requireInternalKey }, async (request, reply) => {
    const parsed = listCatalogServicesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return validationError(reply, parsed.error.issues);
    }

    try {
      return { items: await repository.listServices(parsed.data) };
    } catch (error) {
      app.log.error(error, "Failed to list catalog services");
      return reply.code(500).send({ error: "internal_error" });
    }
  });
};

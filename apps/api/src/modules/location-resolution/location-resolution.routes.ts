import type { FastifyPluginAsync } from "fastify";
import { locationResolutionRequestSchema, locationResolutionResponseSchema } from "@contatocerto/shared";
import { readLocationResolutionConfig } from "../../config/location-resolution.js";
import { createInternalKeyGuard } from "../internal/internal-auth.js";
import { validationError } from "../internal/validation.js";
import { OpenRouteServiceGeocodingProvider } from "./providers/openrouteservice-geocoding.provider.js";
import { DeterministicLocationResolutionService } from "./location-resolution.service.js";
import { GeocodingProviderError, type GeocodingProvider, type LocationResolutionService } from "./location-resolution.types.js";

type LocationResolutionRoutesOptions = { internalApiKey?: string; provider?: GeocodingProvider; service?: LocationResolutionService };

export const locationResolutionRoutes: FastifyPluginAsync<LocationResolutionRoutesOptions> = async (app, options) => {
  const requireInternalKey = createInternalKeyGuard(options.internalApiKey ?? process.env.INTERNAL_API_KEY);
  let service = options.service;
  app.post("/resolve", { preHandler: requireInternalKey }, async (request, reply) => {
    const body = locationResolutionRequestSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    try {
      service ??= new DeterministicLocationResolutionService(() => options.provider ?? new OpenRouteServiceGeocodingProvider(), readLocationResolutionConfig(), diagnostic => {
        app.log.info({ code: "location_resolution_diagnostic", ...diagnostic }, "Location resolution diagnostic");
      });
      return reply.send(locationResolutionResponseSchema.parse(await service.resolve(body.data)));
    } catch (error) {
      if (error instanceof GeocodingProviderError) {
        const status = error.kind === "rate_limited" ? 429 : error.kind === "unavailable" ? 503 : 502;
        const code = error.kind === "rate_limited" ? "geocoding_rate_limited" : error.kind === "unavailable" ? "geocoding_unavailable" : "geocoding_provider_error";
        return reply.code(status).send({ error: code });
      }
      app.log.error(error, "Location resolution failed");
      return reply.code(503).send({ error: "geocoding_unavailable" });
    }
  });
};

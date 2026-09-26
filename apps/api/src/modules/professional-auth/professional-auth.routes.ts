import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createInternalKeyGuard } from "../internal/internal-auth.js";
import { ProfessionalAccessService } from "../professional-access/professional-access.service.js";
import { PostgresProfessionalAuthRepository } from "./professional-auth.repository.js";
import { ProfessionalAuthService } from "./professional-auth.service.js";
import { requestProfessionalAuthChallengeSchema, verifyProfessionalAuthChallengeSchema } from "./professional-auth.types.js";

type AuthService = Pick<ProfessionalAuthService, "requestChallenge" | "verify" | "authenticate" | "revoke">;
type AccessService = Pick<ProfessionalAccessService, "resolveProfessionalAccess">;
type Options = { internalApiKey?: string; service?: AuthService; accessService?: AccessService };
const profileParams = z.object({ professionalId: z.string().uuid() });
const nestedParams = profileParams.extend({ resourceId: z.string().uuid() });

function bearer(request: FastifyRequest) {
  return request.headers.authorization?.replace(/^Bearer\s+/iu, "");
}

async function requireOwnership(
  request: FastifyRequest,
  reply: FastifyReply,
  service: AuthService,
  accessService: AccessService,
  professionalId: string,
) {
  const principal = await service.authenticate(bearer(request));
  if (!principal) {
    reply.code(401).send({ error: "unauthorized" });
    return null;
  }
  const access = await accessService.resolveProfessionalAccess({ accountId: principal.accountId, professionalId });
  if (access.status !== "authorized") {
    reply.code(403).send({ error: "forbidden" });
    return null;
  }
  return principal;
}

async function forward(
  app: FastifyInstance,
  reply: FastifyReply,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  internalApiKey: string | undefined,
  payload?: unknown,
) {
  const response = await app.inject({
    method,
    url,
    headers: { "x-internal-key": internalApiKey ?? "" },
    ...(payload === undefined ? {} : { payload: payload as never }),
  });
  if (response.statusCode === 204) return reply.code(204).send();
  const body = response.json();
  return reply.code(response.statusCode).send(body);
}

export const professionalAuthRoutes: FastifyPluginAsync<Options> = async (app, options) => {
  const internalApiKey = options.internalApiKey ?? process.env.INTERNAL_API_KEY;
  const guard = createInternalKeyGuard(internalApiKey);
  const service = options.service ?? new ProfessionalAuthService();
  const accessService = options.accessService ?? new ProfessionalAccessService();

  app.post("/challenge", { preHandler: guard }, async (request, reply) => {
    const body = requestProfessionalAuthChallengeSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    reply.header("cache-control", "no-store");
    return service.requestChallenge(body.data.phone_e164);
  });

  app.post("/verify", { preHandler: guard }, async (request, reply) => {
    const body = verifyProfessionalAuthChallengeSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_or_expired_code" });
    const result = await service.verify(body.data.challenge_reference, body.data.code);
    if (!result.ok) return reply.code(401).send({ error: "invalid_or_expired_code" });
    reply.header("cache-control", "no-store");
    return result;
  });

  app.post("/logout", { preHandler: guard }, async (request, reply) => {
    await service.revoke(bearer(request));
    return reply.code(204).send();
  });

  app.get("/session", { preHandler: guard }, async (request, reply) => {
    const principal = await service.authenticate(bearer(request));
    return principal
      ? { authenticated: true, expires_at: principal.expiresAt.toISOString() }
      : reply.code(401).send({ error: "unauthorized" });
  });

  app.get("/profiles", { preHandler: guard }, async (request, reply) => {
    const principal = await service.authenticate(bearer(request));
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    return { items: await new PostgresProfessionalAuthRepository().listProfiles(principal.accountId) };
  });

  app.get("/profiles/:professionalId/access", { preHandler: guard }, async (request, reply) => {
    const params = profileParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const principal = await requireOwnership(request, reply, service, accessService, params.data.professionalId);
    return principal ? { authorized: true } : undefined;
  });

  app.get("/profiles/:professionalId/dashboard", { preHandler: guard }, async (request, reply) => {
    const params = profileParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    if (!await requireOwnership(request, reply, service, accessService, params.data.professionalId)) return;
    const id = params.data.professionalId;
    const professional = await app.inject({ method: "GET", url: `/internal/professionals/${id}`, headers: { "x-internal-key": internalApiKey ?? "" } });
    if (professional.statusCode !== 200) return reply.code(professional.statusCode).send(professional.json());
    const services = await app.inject({ method: "GET", url: `/internal/professionals/${id}/services`, headers: { "x-internal-key": internalApiKey ?? "" } });
    if (services.statusCode !== 200) return reply.code(services.statusCode).send(services.json());
    const areas = await app.inject({ method: "GET", url: `/internal/professionals/${id}/service-areas`, headers: { "x-internal-key": internalApiKey ?? "" } });
    if (areas.statusCode !== 200) return reply.code(areas.statusCode).send(areas.json());
    const catalog = await app.inject({ method: "GET", url: "/internal/catalog/services", headers: { "x-internal-key": internalApiKey ?? "" } });
    if (catalog.statusCode !== 200) return reply.code(catalog.statusCode).send(catalog.json());
    return {
      professional: professional.json(),
      services: (services.json() as { items: unknown[] }).items,
      areas: (areas.json() as { items: unknown[] }).items,
      catalog: (catalog.json() as { items: unknown[] }).items,
    };
  });

  app.patch("/profiles/:professionalId", { preHandler: guard }, async (request, reply) => {
    const params = profileParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    if (!await requireOwnership(request, reply, service, accessService, params.data.professionalId)) return;
    return forward(app, reply, "PATCH", `/internal/professionals/${params.data.professionalId}`, internalApiKey, request.body);
  });

  app.patch("/profiles/:professionalId/availability", { preHandler: guard }, async (request, reply) => {
    const params = profileParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    if (!await requireOwnership(request, reply, service, accessService, params.data.professionalId)) return;
    return forward(app, reply, "PATCH", `/internal/professionals/${params.data.professionalId}/availability`, internalApiKey, request.body);
  });

  app.post("/profiles/:professionalId/services", { preHandler: guard }, async (request, reply) => {
    const params = profileParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    if (!await requireOwnership(request, reply, service, accessService, params.data.professionalId)) return;
    return forward(app, reply, "POST", `/internal/professionals/${params.data.professionalId}/services`, internalApiKey, request.body);
  });

  app.patch("/profiles/:professionalId/services/:resourceId", { preHandler: guard }, async (request, reply) => {
    const params = nestedParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    if (!await requireOwnership(request, reply, service, accessService, params.data.professionalId)) return;
    return forward(app, reply, "PATCH", `/internal/professionals/${params.data.professionalId}/services/${params.data.resourceId}`, internalApiKey, request.body);
  });

  app.delete("/profiles/:professionalId/services/:resourceId", { preHandler: guard }, async (request, reply) => {
    const params = nestedParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    if (!await requireOwnership(request, reply, service, accessService, params.data.professionalId)) return;
    return forward(app, reply, "PATCH", `/internal/professionals/${params.data.professionalId}/services/${params.data.resourceId}`, internalApiKey, { is_active: false });
  });

  app.post("/profiles/:professionalId/service-areas", { preHandler: guard }, async (request, reply) => {
    const params = profileParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    if (!await requireOwnership(request, reply, service, accessService, params.data.professionalId)) return;
    return forward(app, reply, "POST", `/internal/professionals/${params.data.professionalId}/service-areas`, internalApiKey, request.body);
  });

  app.patch("/profiles/:professionalId/service-areas/:resourceId", { preHandler: guard }, async (request, reply) => {
    const params = nestedParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    if (!await requireOwnership(request, reply, service, accessService, params.data.professionalId)) return;
    return forward(app, reply, "PATCH", `/internal/professionals/${params.data.professionalId}/service-areas/${params.data.resourceId}`, internalApiKey, request.body);
  });

  app.delete("/profiles/:professionalId/service-areas/:resourceId", { preHandler: guard }, async (request, reply) => {
    const params = nestedParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    if (!await requireOwnership(request, reply, service, accessService, params.data.professionalId)) return;
    return forward(app, reply, "DELETE", `/internal/professionals/${params.data.professionalId}/service-areas/${params.data.resourceId}`, internalApiKey);
  });
};

import { dashboardMutationSchema, professionalResponseSchema } from "@contatocerto/shared";

type Dependencies = {
  authorize: () => Promise<void>;
  professionalId: () => string | Promise<string>;
  api: (path: string, init: RequestInit) => Promise<unknown>;
  professionalBase?: (professionalId: string) => string;
  selfServiceLifecycleEnabled?: boolean;
};

export async function handleDashboardMutation(request: Request, dependencies: Dependencies): Promise<Response> {
  try {
    await dependencies.authorize();
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    const parsed = dashboardMutationSchema.safeParse({ method: request.method, payload: await request.json() });
    if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
    const { method, payload } = parsed.data;
    if ((payload.action === "publish" || payload.action === "unpublish") && !dependencies.selfServiceLifecycleEnabled) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    const owner = professionalResponseSchema.shape.id.parse(await dependencies.professionalId());
    const base = dependencies.professionalBase?.(owner) ?? `/internal/professionals/${owner}`;
    let path = base;
    if (payload.action === "availability") path += "/availability";
    if (payload.action === "service") path += `/services${"id" in payload ? `/${payload.id}` : ""}`;
    if (payload.action === "area") path += `/service-areas${"id" in payload ? `/${payload.id}` : ""}`;
    if (payload.action === "publish") path += "/publish";
    if (payload.action === "unpublish") path += "/unpublish";
    const result = await dependencies.api(path, {
      method,
      body: "data" in payload ? JSON.stringify(payload.data) : undefined,
    });
    return Response.json(result ?? { ok: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "request_failed";
    if (code === "dashboard_unauthorized") return Response.json({ error: "unauthorized" }, { status: 401 });
    if (code === "professional_forbidden") return Response.json({ error: "forbidden" }, { status: 403 });
    const message = ({
      professional_not_active: "Seu cadastro precisa estar ativo para ficar disponível.",
      professional_not_ready: "Complete os itens do cadastro antes de publicar ou ativar a disponibilidade.",
      professional_suspended: "Este perfil está suspenso e precisa de atendimento da equipe.",
      professional_not_draft: "Este perfil não está em rascunho.",
      service_inactive: "Esse serviço não está mais disponível no catálogo.",
    } as Record<string, string>)[code] ?? "Não foi possível salvar suas alterações.";
    return Response.json({ error: message }, { status: 400 });
  }
}

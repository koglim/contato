import { dashboardMutationSchema, professionalResponseSchema } from "@contatocerto/shared";

type Dependencies = {
  authorize: () => Promise<void>;
  professionalId: () => string;
  api: (path: string, init: RequestInit) => Promise<unknown>;
};

// The HTTP handler uses this same boundary; validation is not just a UI rule.
export async function handleDashboardMutation(request: Request, dependencies: Dependencies): Promise<Response> {
  try {
    await dependencies.authorize();
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    const parsed = dashboardMutationSchema.safeParse({ method: request.method, payload: await request.json() });
    if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
    const { method, payload } = parsed.data;
    const owner = professionalResponseSchema.shape.id.parse(dependencies.professionalId());
    const base = `/internal/professionals/${owner}`;
    let path = base;
    if (payload.action === "availability") path += "/availability";
    if (payload.action === "service") path += `/services${"id" in payload ? `/${payload.id}` : ""}`;
    if (payload.action === "area") path += `/service-areas${"id" in payload ? `/${payload.id}` : ""}`;
    const result = await dependencies.api(path, {
      method,
      body: "data" in payload ? JSON.stringify(payload.data) : undefined,
    });
    return Response.json(result ?? { ok: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "request_failed";
    if (code === "dashboard_unauthorized") return Response.json({ error: "unauthorized" }, { status: 401 });
    const message = ({
      professional_not_active: "Seu cadastro precisa estar ativo para ficar disponível.",
      service_inactive: "Esse serviço não está mais disponível no catálogo.",
    } as Record<string, string>)[code] ?? "Não foi possível salvar suas alterações.";
    return Response.json({ error: message }, { status: 400 });
  }
}

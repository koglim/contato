import { NextResponse } from "next/server";
import { api, dashboardProfessionalId, getDashboardData } from "../../../lib/api/server";
import { requireDashboardAccess } from "../../../lib/auth/dashboard";

const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
function errorResponse(error: unknown) { const code = error instanceof Error ? error.message : "request_failed"; if (code === "dashboard_unauthorized") return json({ error: "unauthorized" }, 401); if (code === "invalid_action") return json({ error: "invalid_action" }, 400); const message = ({ professional_not_active: "Seu cadastro precisa estar ativo para ficar disponível.", service_inactive: "Esse serviço não está mais disponível no catálogo." } as Record<string, string>)[code] ?? "Não foi possível salvar suas alterações."; return json({ error: message }, 400); }

export async function GET() { try { await requireDashboardAccess(); return json(await getDashboardData()); } catch { return json({ error: "unauthorized" }, 401); } }
export async function POST(request: Request) { return mutate(request, "POST"); }
export async function PATCH(request: Request) { return mutate(request, "PATCH"); }
export async function DELETE(request: Request) { return mutate(request, "DELETE"); }

async function mutate(request: Request, method: string) {
  try {
    await requireDashboardAccess(); const { action, id, data } = await request.json(); const professionalId = dashboardProfessionalId();
    const routes: Record<string, string> = {
      profile: `/internal/professionals/${professionalId}`,
      availability: `/internal/professionals/${professionalId}/availability`,
      service: id ? `/internal/professionals/${professionalId}/services/${id}` : `/internal/professionals/${professionalId}/services`,
      area: id ? `/internal/professionals/${professionalId}/service-areas/${id}` : `/internal/professionals/${professionalId}/service-areas`,
    };
    if (!routes[action]) return json({ error: "invalid_action" }, 400);
    const result = await api(routes[action], { method, body: method === "DELETE" ? undefined : JSON.stringify(data) });
    return json(result ?? { ok: true });
  } catch (error) { return errorResponse(error); }
}

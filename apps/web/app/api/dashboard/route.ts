import { NextResponse } from "next/server";
import {
  api,
  authApi,
  dashboardProfessionalContext,
  dashboardProfessionalId,
  getDashboardData,
} from "../../../lib/api/server";
import { professionalAuthEnabled } from "../../../lib/auth/dashboard";
import { requireDashboardAccess } from "../../../lib/auth/dashboard";
import { sameOriginError } from "../../../lib/auth/same-origin";
import { handleDashboardMutation } from "../../../lib/dashboard/mutation";

const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

export async function GET() {
  try {
    await requireDashboardAccess();
    return json(await getDashboardData());
  } catch (error) {
    const code = error instanceof Error ? error.message : "request_failed";
    if (code === "dashboard_unauthorized") return json({ error: "unauthorized" }, 401);
    if (code === "professional_forbidden") return json({ error: "forbidden" }, 403);
    return json({ error: "request_failed" }, 500);
  }
}

export async function POST(request: Request) { return mutate(request); }
export async function PATCH(request: Request) { return mutate(request); }
export async function DELETE(request: Request) { return mutate(request); }

async function mutate(request: Request) {
  const originError = sameOriginError(request);
  if (originError) return originError;
  const enabled = professionalAuthEnabled();
  return handleDashboardMutation(request, {
    authorize: requireDashboardAccess,
    professionalId: enabled
      ? async () => {
          const context = await dashboardProfessionalContext();
          if (context.status === "no_profiles") throw new Error("professional_forbidden");
          return context.id;
        }
      : dashboardProfessionalId,
    api: enabled ? authApi : api,
    selfServiceLifecycleEnabled: enabled,
    ...(enabled ? { professionalBase: (id: string) => `/profiles/${id}` } : {}),
  });
}

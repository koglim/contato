import { NextResponse } from "next/server";
import { api, dashboardProfessionalId, getDashboardData } from "../../../lib/api/server";
import { requireDashboardAccess } from "../../../lib/auth/dashboard";
import { handleDashboardMutation } from "../../../lib/dashboard/mutation";

const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

export async function GET() { try { await requireDashboardAccess(); return json(await getDashboardData()); } catch { return json({ error: "unauthorized" }, 401); } }
export async function POST(request: Request) { return mutate(request); }
export async function PATCH(request: Request) { return mutate(request); }
export async function DELETE(request: Request) { return mutate(request); }

function mutate(request: Request) {
  return handleDashboardMutation(request, { authorize: requireDashboardAccess, professionalId: dashboardProfessionalId, api });
}

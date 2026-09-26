import { NextResponse } from "next/server";
import { api, dashboardProfessionalContext, dashboardProfessionalId, getDashboardData } from "../../../lib/api/server";
import { professionalAuthEnabled } from "../../../lib/auth/dashboard";
import { requireDashboardAccess } from "../../../lib/auth/dashboard";
import { handleDashboardMutation } from "../../../lib/dashboard/mutation";

const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

export async function GET() { try { await requireDashboardAccess(); return json(await getDashboardData()); } catch { return json({ error: "unauthorized" }, 401); } }
export async function POST(request: Request) { return mutate(request); }
export async function PATCH(request: Request) { return mutate(request); }
export async function DELETE(request: Request) { return mutate(request); }

function mutate(request: Request) {
  const origin=request.headers.get("origin"),expected=new URL(request.url).origin;if(origin&&origin!==expected)return Response.json({error:"invalid_origin"},{status:403});
  return handleDashboardMutation(request, { authorize: requireDashboardAccess, professionalId: professionalAuthEnabled()?async()=>(await dashboardProfessionalContext()).id:dashboardProfessionalId, api });
}

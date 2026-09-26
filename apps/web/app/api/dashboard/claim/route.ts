import { claimProfessionalInputSchema, claimProfessionalResponseSchema } from "@contatocerto/shared";
import { NextResponse } from "next/server";
import { authApi } from "../../../../lib/api/server";
import { requireDashboardAccess, professionalAuthEnabled } from "../../../../lib/auth/dashboard";
import { sameOriginError } from "../../../../lib/auth/same-origin";

export async function POST(request: Request) {
  const originError = sameOriginError(request);
  if (originError) return originError;
  try {
    await requireDashboardAccess();
    if (!professionalAuthEnabled()) return NextResponse.json({ error: "not_available" }, { status: 404 });
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    const input = claimProfessionalInputSchema.safeParse(await request.json());
    if (!input.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const result = claimProfessionalResponseSchema.parse(
      await authApi(`/profiles/${input.data.professional_id}/claim`, { method: "POST" }),
    );
    const response = NextResponse.json(result, { status: 200 });
    response.cookies.set("contatocerto_dashboard_profile", result.professional.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return response;
  } catch (error) {
    const code = error instanceof Error ? error.message : "request_failed";
    if (code === "dashboard_unauthorized") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (code === "professional_forbidden" || code === "forbidden" || code === "claim_forbidden") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (code === "professional_not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (code === "claim_conflict") return NextResponse.json({ error: "claim_conflict" }, { status: 409 });
    return NextResponse.json({ error: "request_failed" }, { status: 400 });
  }
}

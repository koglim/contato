import { createSelfServiceProfessionalSchema, professionalResponseSchema } from "@contatocerto/shared";
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
    const input = createSelfServiceProfessionalSchema.safeParse(await request.json());
    if (!input.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const professional = professionalResponseSchema.parse(await authApi("/profiles", {
      method: "POST",
      body: JSON.stringify(input.data),
    }));
    const response = NextResponse.json(professional, { status: 201 });
    response.cookies.set("contatocerto_dashboard_profile", professional.id, {
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
    if (code === "professional_forbidden" || code === "identity_unverified") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "request_failed" }, { status: 400 });
  }
}

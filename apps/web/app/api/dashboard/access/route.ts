import { NextResponse } from "next/server";
import { dashboardCookieName } from "../../../../lib/auth/dashboard";
import { createDashboardSession, dashboardSessionDurationSeconds, hasMatchingDemoPassword } from "../../../../lib/auth/session";

export async function POST(request: Request) {
  const { password } = await request.json().catch(() => ({}));
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  if (!secret || !hasMatchingDemoPassword(password, process.env.DASHBOARD_DEMO_PASSWORD)) return NextResponse.json({ error: "invalid_password" }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(dashboardCookieName, createDashboardSession(secret), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: dashboardSessionDurationSeconds });
  return response;
}

import { NextResponse } from "next/server";
import { dashboardCookieName } from "../../../../lib/auth/dashboard";

export async function POST(request: Request) {
  const { password } = await request.json().catch(() => ({}));
  if (!process.env.DASHBOARD_DEMO_PASSWORD || password !== process.env.DASHBOARD_DEMO_PASSWORD) return NextResponse.json({ error: "invalid_password" }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(dashboardCookieName, "granted", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/dashboard", maxAge: 60 * 60 * 12 });
  return response;
}

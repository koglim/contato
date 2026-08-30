import "server-only";
import { cookies } from "next/headers";
import { isDashboardSessionValid } from "./session";

export const dashboardCookieName = "contatocerto_dashboard_access";

export async function hasDashboardAccess() { return isDashboardSessionValid((await cookies()).get(dashboardCookieName)?.value, process.env.DASHBOARD_SESSION_SECRET); }
export async function requireDashboardAccess() { if (!(await hasDashboardAccess())) throw new Error("dashboard_unauthorized"); }

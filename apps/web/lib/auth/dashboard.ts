import "server-only";
import { cookies } from "next/headers";

export const dashboardCookieName = "contatocerto_dashboard_access";

export async function hasDashboardAccess() { return (await cookies()).get(dashboardCookieName)?.value === "granted"; }
export async function requireDashboardAccess() { if (!(await hasDashboardAccess())) throw new Error("dashboard_unauthorized"); }

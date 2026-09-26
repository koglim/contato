import "server-only";
import { cookies } from "next/headers";
import { isDashboardSessionValid } from "./session";

export const dashboardCookieName = "contatocerto_dashboard_access";

export function professionalAuthEnabled(){return process.env.PROFESSIONAL_AUTH_ENABLED==="true";}
export async function hasDashboardAccess() {
  const token=(await cookies()).get(dashboardCookieName)?.value;
  if(!professionalAuthEnabled()) return isDashboardSessionValid(token,process.env.DASHBOARD_SESSION_SECRET);
  if(!token||!process.env.CONTATOCERTO_API_URL||!process.env.INTERNAL_API_KEY)return false;
  const response=await fetch(`${process.env.CONTATOCERTO_API_URL}/internal/professional-auth/session`,{cache:"no-store",headers:{"x-internal-key":process.env.INTERNAL_API_KEY,authorization:`Bearer ${token}`}}).catch(()=>null);
  return response?.ok===true;
}
export async function requireDashboardAccess() { if (!(await hasDashboardAccess())) throw new Error("dashboard_unauthorized"); }

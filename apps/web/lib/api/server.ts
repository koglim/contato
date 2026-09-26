import "server-only";
import type { ProfessionalResponse, ProfessionalServiceResponse, ServiceAreaResponse, ServiceCatalogItem } from "@contatocerto/shared";
import { cookies } from "next/headers";
import { dashboardCookieName,professionalAuthEnabled } from "../auth/dashboard";

export type DashboardProfile={id:string;display_name:string;slug:string;role:string};
export type DashboardData = { professional: ProfessionalResponse; services: ProfessionalServiceResponse[]; areas: ServiceAreaResponse[]; catalog: ServiceCatalogItem[]; profiles?:DashboardProfile[] };

function config() {
  const baseUrl = process.env.CONTATOCERTO_API_URL;
  const key = process.env.INTERNAL_API_KEY;
  const professionalId = process.env.DASHBOARD_PROFESSIONAL_ID;
  if (!baseUrl || !key || (!professionalAuthEnabled()&&!professionalId)) throw new Error("Dashboard environment is not configured");
  return { baseUrl, key, professionalId };
}

export function dashboardProfessionalId() { const id=config().professionalId;if(!id)throw new Error("Dashboard professional is not configured");return id; }

async function authApi<T>(path:string,init:RequestInit={}){const{baseUrl,key}=config();const token=(await cookies()).get(dashboardCookieName)?.value;if(!token)throw new Error("dashboard_unauthorized");const response=await fetch(`${baseUrl}/internal/professional-auth${path}`,{...init,cache:"no-store",headers:{"content-type":"application/json","x-internal-key":key,authorization:`Bearer ${token}`,...init.headers}});if(!response.ok)throw new Error(response.status===401?"dashboard_unauthorized":"professional_forbidden");return response.json() as Promise<T>;}
export async function dashboardProfessionalContext(){if(!professionalAuthEnabled())return{id:dashboardProfessionalId(),profiles:undefined};const profiles=(await authApi<{items:DashboardProfile[]}>("/profiles")).items;if(profiles.length===0)throw new Error("no_professional_profiles");const selected=(await cookies()).get("contatocerto_dashboard_profile")?.value;const profile=profiles.find(item=>item.id===selected)??profiles[0]!;await authApi(`/profiles/${profile.id}/access`);return{id:profile.id,profiles};}

export async function api<T>(path: string, init: RequestInit = {}) {
  const { baseUrl, key } = config();
  const response = await fetch(`${baseUrl}${path}`, { ...init, cache: "no-store", headers: { "content-type": "application/json", "x-internal-key": key, ...init.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "request_failed");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function getDashboardData(): Promise<DashboardData> {
  const context=await dashboardProfessionalContext();const id=context.id;
  const [professional, services, areas, catalog] = await Promise.all([
    api<ProfessionalResponse>(`/internal/professionals/${id}`),
    api<{ items: ProfessionalServiceResponse[] }>(`/internal/professionals/${id}/services`),
    api<{ items: ServiceAreaResponse[] }>(`/internal/professionals/${id}/service-areas`),
    api<{ items: ServiceCatalogItem[] }>("/internal/catalog/services"),
  ]);
  return { professional, services: services.items, areas: areas.items, catalog: catalog.items,profiles:context.profiles };
}

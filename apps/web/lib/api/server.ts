import "server-only";
import type { ProfessionalResponse, ProfessionalServiceResponse, ServiceAreaResponse, ServiceCatalogItem } from "@contatocerto/shared";

type DashboardData = { professional: ProfessionalResponse; services: ProfessionalServiceResponse[]; areas: ServiceAreaResponse[]; catalog: ServiceCatalogItem[] };

function config() {
  const baseUrl = process.env.CONTATOCERTO_API_URL;
  const key = process.env.INTERNAL_API_KEY;
  const professionalId = process.env.DASHBOARD_PROFESSIONAL_ID;
  if (!baseUrl || !key || !professionalId) throw new Error("Dashboard environment is not configured");
  return { baseUrl, key, professionalId };
}

export function dashboardProfessionalId() { return config().professionalId; }

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
  const id = dashboardProfessionalId();
  const [professional, services, areas, catalog] = await Promise.all([
    api<ProfessionalResponse>(`/internal/professionals/${id}`),
    api<{ items: ProfessionalServiceResponse[] }>(`/internal/professionals/${id}/services`),
    api<{ items: ServiceAreaResponse[] }>(`/internal/professionals/${id}/service-areas`),
    api<{ items: ServiceCatalogItem[] }>("/internal/catalog/services"),
  ]);
  return { professional, services: services.items, areas: areas.items, catalog: catalog.items };
}

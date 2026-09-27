import "server-only";
import type {
  ClaimableProfessional,
  ProfessionalResponse,
  ProfessionalEligibility,
  ProfessionalEntitlementSnapshot,
  ProfessionalServiceResponse,
  ServiceAreaResponse,
  ServiceCatalogItem,
} from "@contatocerto/shared";
import { cookies } from "next/headers";
import { dashboardCookieName, professionalAuthEnabled } from "../auth/dashboard";

export type DashboardProfile = { id: string; display_name: string; slug: string; role: string };
export type ReadyDashboardData = {
  status: "ready";
  professional: ProfessionalResponse;
  services: ProfessionalServiceResponse[];
  areas: ServiceAreaResponse[];
  catalog: ServiceCatalogItem[];
  eligibility: ProfessionalEligibility;
  entitlement?: ProfessionalEntitlementSnapshot;
  profiles?: DashboardProfile[];
};
export type DashboardData = ReadyDashboardData | { status: "no_profiles"; profiles: []; claimableProfiles?: ClaimableProfessional[] };

function demoEligibility(professional: ProfessionalResponse, services: ProfessionalServiceResponse[], areas: ServiceAreaResponse[]): ProfessionalEligibility {
  const identityVerified = true;
  const profileComplete = professional.display_name.trim().length >= 2 && professional.slug.trim().length > 0 && /^\+[1-9]\d{7,14}$/u.test(professional.phone_e164);
  const hasActiveService = services.some(item => item.is_active);
  const hasServiceArea = areas.length > 0;
  const ready = identityVerified && profileComplete && hasActiveService && hasServiceArea;
  const active = professional.status === "active";
  const reasons: ProfessionalEligibility["reasons"] = [];
  if (!profileComplete) reasons.push("profile_incomplete");
  if (!hasActiveService) reasons.push("no_active_service");
  if (!hasServiceArea) reasons.push("no_service_area");
  if (professional.status === "draft") reasons.push("profile_draft");
  if (professional.status === "suspended") reasons.push("profile_suspended");
  return { policy_version: "eligibility-v1", professional_id: professional.id, identity_verified: identityVerified,
    profile_complete: profileComplete, has_active_service: hasActiveService, has_service_area: hasServiceArea,
    profile_status: professional.status, ready_to_publish: ready, can_appear_in_matching: ready && active,
    can_receive_opportunities: ready && active, can_set_available_now: ready && active, reasons };
}

function config() {
  const baseUrl = process.env.CONTATOCERTO_API_URL;
  const key = process.env.INTERNAL_API_KEY;
  const professionalId = process.env.DASHBOARD_PROFESSIONAL_ID;
  if (!baseUrl || !key || (!professionalAuthEnabled() && !professionalId)) {
    throw new Error("Dashboard environment is not configured");
  }
  return { baseUrl, key, professionalId };
}

export function dashboardProfessionalId() {
  const id = config().professionalId;
  if (!id) throw new Error("Dashboard professional is not configured");
  return id;
}

export async function authApi<T>(path: string, init: RequestInit = {}) {
  const { baseUrl, key } = config();
  const token = (await cookies()).get(dashboardCookieName)?.value;
  if (!token) throw new Error("dashboard_unauthorized");
  const response = await fetch(`${baseUrl}/internal/professional-auth${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "x-internal-key": key,
      authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("dashboard_unauthorized");
    if (response.status === 403) throw new Error("professional_forbidden");
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "request_failed");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function dashboardProfessionalContext() {
  if (!professionalAuthEnabled()) return { status: "ready" as const, id: dashboardProfessionalId(), profiles: undefined };
  const profiles = (await authApi<{ items: DashboardProfile[] }>("/profiles")).items;
  if (profiles.length === 0) {
    const claimableProfiles = (await authApi<{ items: ClaimableProfessional[] }>("/claimable-profiles")).items;
    return { status: "no_profiles" as const, profiles: [] as [], claimableProfiles };
  }
  const selected = (await cookies()).get("contatocerto_dashboard_profile")?.value;
  const profile = profiles.find(item => item.id === selected) ?? profiles[0]!;
  return { status: "ready" as const, id: profile.id, profiles };
}

export async function api<T>(path: string, init: RequestInit = {}) {
  const { baseUrl, key } = config();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    cache: "no-store",
    headers: { "content-type": "application/json", "x-internal-key": key, ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "request_failed");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function getDashboardData(): Promise<DashboardData> {
  const context = await dashboardProfessionalContext();
  if (context.status === "no_profiles") return context;
  const id = context.id;
  if (professionalAuthEnabled()) {
    const dashboard = await authApi<Omit<ReadyDashboardData, "status" | "profiles">>(`/profiles/${id}/dashboard`);
    return { status: "ready", ...dashboard, profiles: context.profiles };
  }
  const [professional, services, areas, catalog] = await Promise.all([
    api<ProfessionalResponse>(`/internal/professionals/${id}`),
    api<{ items: ProfessionalServiceResponse[] }>(`/internal/professionals/${id}/services`),
    api<{ items: ServiceAreaResponse[] }>(`/internal/professionals/${id}/service-areas`),
    api<{ items: ServiceCatalogItem[] }>("/internal/catalog/services"),
  ]);
  return {
    status: "ready",
    professional,
    services: services.items,
    areas: areas.items,
    catalog: catalog.items,
    eligibility: demoEligibility(professional, services.items, areas.items),
    profiles: context.profiles,
  };
}

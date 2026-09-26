import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardContent } from "../../components/dashboard/dashboard-content";
import type { ProfessionalEligibility, ProfessionalResponse } from "@contatocerto/shared";

const read = (path: string) => readFileSync(path, "utf8");

test("zero-profile dashboard renders explicit onboarding and selects the created profile", () => {
  const page = read("components/dashboard/page.tsx");
  const onboarding = read("components/dashboard/onboarding.tsx");
  const route = read("app/api/dashboard/onboarding/route.ts");
  assert.match(page, /status==="no_profiles".*ProfessionalOnboarding/u);
  assert.match(onboarding, /Crie seu perfil profissional/u);
  assert.match(onboarding, /Criar perfil/u);
  assert.match(route, /contatocerto_dashboard_profile/u);
  assert.match(route, /professional\.id/u);
});

test("overview renders the derived checklist and every lifecycle state", () => {
  const source = read("components/dashboard/dashboard-content.tsx");
  for (const copy of ["Identidade verificada", "Perfil básico", "Adicionar pelo menos um serviço", "Definir uma área de atendimento", "Publicar perfil", "Despublicar perfil", "Perfil suspenso pela equipe", "deixou de atender aos requisitos atuais"]) {
    assert.match(source, new RegExp(copy, "u"));
  }
});

test("multi-profile selector remains available after onboarding", () => {
  const source = read("components/dashboard/page.tsx");
  assert.match(source, /data\.profiles&&data\.profiles\.length>1\?<ProfileSelector/u);
});

const professional = (status: ProfessionalResponse["status"]): ProfessionalResponse => ({
  id: "11111111-1111-4111-8111-111111111111", display_name: "Ana Profissional", slug: "ana-profissional",
  bio: null, phone_e164: "+5566999999999", email: null, profile_image_url: null, status,
  is_verified: false, is_available_now: false, available_now_updated_at: null,
  created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString(),
});
const eligibility = (status: ProfessionalResponse["status"], ready: boolean): ProfessionalEligibility => ({
  policy_version: "eligibility-v1", professional_id: professional(status).id, identity_verified: true,
  profile_complete: true, has_active_service: ready, has_service_area: ready, profile_status: status,
  ready_to_publish: ready, can_appear_in_matching: ready && status === "active",
  can_receive_opportunities: ready && status === "active", can_set_available_now: ready && status === "active",
  reasons: ready ? (status === "draft" ? ["profile_draft"] : []) : ["no_active_service", "no_service_area"],
});
function renderDashboard(section: "overview" | "availability", status: ProfessionalResponse["status"], ready: boolean, enabled: boolean) {
  return renderToStaticMarkup(createElement(DashboardContent, {
    section, selfServiceLifecycleEnabled: enabled,
    data: { professional: professional(status), eligibility: eligibility(status, ready), services: [], areas: [], catalog: [] },
  }));
}

test("demo mode hides lifecycle and keeps the previous availability control", () => {
  const overview = renderDashboard("overview", "active", true, false);
  assert.doesNotMatch(overview, /Publicar perfil|Despublicar perfil|Prepare seu perfil/u);
  const availability = renderDashboard("availability", "draft", false, false);
  assert.match(availability, /role="switch"/u);
  assert.doesNotMatch(availability, /disabled=""/u);
});

test("passwordless mode renders lifecycle and applies eligibility availability gating", () => {
  const draft = renderDashboard("overview", "draft", true, true);
  assert.match(draft, /Identidade verificada/u);
  assert.match(draft, /Publicar perfil/u);
  const active = renderDashboard("overview", "active", true, true);
  assert.match(active, /Despublicar perfil/u);
  const unavailable = renderDashboard("availability", "draft", false, true);
  assert.match(unavailable, /disabled=""/u);
});

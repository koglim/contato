import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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

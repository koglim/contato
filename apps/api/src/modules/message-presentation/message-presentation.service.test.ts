import assert from "node:assert/strict";
import test from "node:test";
import type { CustomerSearchMessageResponse } from "@contatocerto/shared";
import { DefaultMessagePresenter } from "./message-presentation.service.js";
import { BILATERAL_NOTICE } from "../bilateral-contact/bilateral-contact.policy.js";

const customerId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const searchRequestId = "33333333-3333-4333-8333-333333333333";
const matchId = "44444444-4444-4444-8444-444444444444";
const professionalId = "55555555-5555-4555-8555-555555555555";

function response(status: "needs_location" | "needs_service" | "matched" | "no_matches", overrides: Record<string, unknown> = {}) {
  const matching = {
    search_request_id: searchRequestId,
    status: status === "matched" ? "matched" : "ready",
    service: { id: customerId, name: "Eletricista", slug: "eletricista" },
    location: { latitude: -11.86, longitude: -55.5, city: "Sinop", state: "MT", neighborhood: null },
    matches: status === "matched" ? [{
      match_id: matchId,
      rank_position: 1,
      distance_meters: 2483,
      effective_available_now: true,
      professional: { id: professionalId, display_name: "Ricardo Santos", slug: "ricardo-santos", bio: "bio", profile_image_url: null, is_verified: false },
      service: { professional_service_id: conversationId, description: "", price_mode: "from", price_from_cents: 15000, price_to_cents: null },
      service_area: { id: professionalId, label: "Sinop", city: "Sinop", state: "MT", radius_meters: 40000 },
    }] : [],
    meta: { count: status === "matched" ? 1 : 0, limit: 3, availability_freshness_minutes: 240 },
  };
  const result = status === "needs_location"
    ? { status, stage: "interpretation", reason: "location_not_understood", interpretation: { status, raw_text: "+5566999999999 email@teste.com", service_text: "score 0.9", location_text: null, country_code: "BR", interpretation: { service_strategy: "full_message", location_strategy: "none" } }, orchestration: null }
    : status === "needs_service"
      ? { status, stage: "service_resolution", reason: "unresolved", interpretation: { status: "interpreted", raw_text: "+5566999999999 email@teste.com", service_text: "score 0.9", location_text: "Sinop", country_code: "BR", interpretation: { service_strategy: "full_message", location_strategy: "locative_phrase" } }, orchestration: { status, reason: "unresolved", service_resolution: { status: "unresolved", normalized_text: "", match: null, candidates: [] }, location_resolution: null, matching: null } }
      : { status, stage: "matching", reason: null, interpretation: { status: "interpreted", raw_text: "+5566999999999 email@teste.com", service_text: "score 0.9", location_text: "Sinop", country_code: "BR", interpretation: { service_strategy: "full_message", location_strategy: "locative_phrase" } }, orchestration: { status, reason: null, service_resolution: { status: "resolved", normalized_text: "eletricista", match: { service: matching.service, method: "exact", matched_term: "eletricista", confidence: 1 }, candidates: [] }, location_resolution: { status: "resolved", query: "Sinop", country_code: "BR", match: { label: "Sinop", latitude: -11.86, longitude: -55.5, city: "Sinop", state: "MT", neighborhood: null, country_code: "BR", confidence: 1, layer: "locality" }, candidates: [], provider: "fake" }, matching } };
  return {
    customer_id: customerId,
    route: "started",
    conversation: { conversation_id: status === "matched" || status === "no_matches" ? null : conversationId, conversation_status: status === "matched" || status === "no_matches" ? "completed" : "active", pending_slot: status === "needs_location" ? "location" : status === "needs_service" ? "service" : undefined, result: { ...result, ...overrides } },
  } as CustomerSearchMessageResponse;
}

function matchedWith(overrides: Record<string, unknown>) {
  const value = response("matched") as unknown as { conversation: { result: { orchestration: { matching: { matches: Record<string, unknown>[] } } } } };
  Object.assign(value.conversation.result.orchestration.matching.matches[0], overrides);
  return value as CustomerSearchMessageResponse;
}

const presenter = new DefaultMessagePresenter();

test("presents concise prompts for pending location and service", () => {
  assert.equal(presenter.present(response("needs_location")), "Em qual cidade você precisa do atendimento?");
  assert.equal(presenter.present(response("needs_service")), "Qual serviço você precisa? Pode me contar o que aconteceu.");
});

test("presents one matched professional using public fields only", () => {
  assert.equal(presenter.present(response("matched") as never), `Encontrei um profissional para você 👇\n\n1. *Ricardo Santos*\nEletricista\n📍 2,5 km\n💰 A partir de R$\u00a0150,00\n\n${BILATERAL_NOTICE}\n\nResponda com o número ou com o nome do profissional que você quer escolher.`);
});

test("presents matches in their received order", () => {
  const value = response("matched") as unknown as { conversation: { result: { orchestration: { matching: { matches: Array<Record<string, unknown>> } } } } };
  value.conversation.result.orchestration.matching.matches.push({
    ...value.conversation.result.orchestration.matching.matches[0],
    professional: { id: customerId, display_name: "Ana Lima", slug: "ana-lima", bio: null, profile_image_url: null, is_verified: true },
    distance_meters: 850,
  });
  const text = presenter.present(value as never);
  assert.match(text, /^Encontrei 2 profissionais para você 👇/u);
  assert.ok(text.indexOf("1. *Ricardo Santos*") < text.indexOf("2. *Ana Lima*"));
  assert.match(text, /📍 850 m/u);
  assert.match(text, /Responda com o número ou com o nome do profissional/u);
});

test("presents the no matches guidance", () => {
  assert.equal(presenter.present(response("no_matches")), "Não encontrei profissionais disponíveis para esse serviço nessa região no momento.\n\nSe quiser, você pode tentar outra região ou fazer uma nova busca.");
});

test("formats every price mode and missing values safely", () => {
  const fixed = matchedWith({ service: { professional_service_id: conversationId, description: null, price_mode: "fixed", price_from_cents: 15000, price_to_cents: null } });
  const range = matchedWith({ service: { professional_service_id: conversationId, description: null, price_mode: "range", price_from_cents: 15000, price_to_cents: 25000 } });
  const quote = matchedWith({ service: { professional_service_id: conversationId, description: null, price_mode: "quote", price_from_cents: null, price_to_cents: null } });
  const missing = matchedWith({ service: { professional_service_id: conversationId, description: null, price_mode: "fixed", price_from_cents: null, price_to_cents: null } });
  assert.match(presenter.present(fixed as never), /💰 R\$\s?150,00/u);
  assert.match(presenter.present(range as never), /💰 R\$\s?150,00 a R\$\s?250,00/u);
  assert.match(presenter.present(quote as never), /💰 Sob consulta/u);
  assert.match(presenter.present(missing as never), /💰 Preço sob consulta/u);
});

test("does not leak private or internal values", () => {
  const text = presenter.present(response("matched") as never);
  for (const value of ["+5566999999999", "email@teste.com", customerId, conversationId, searchRequestId, matchId, professionalId, "score 0.9"]) {
    assert.equal(text.includes(value), false);
  }
});

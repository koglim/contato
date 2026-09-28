import test from "node:test";
import assert from "node:assert/strict";
import { presentSelectionInquiry, type CandidateInquiryFact } from "./selection-inquiry.presenter.js";

const sampleCandidates: CandidateInquiryFact[] = [
  {
    position: 1,
    displayName: "João Silva",
    distanceMeters: 3200,
    priceMode: "fixed",
    priceFromCents: 15000,
    priceToCents: null,
    isVerified: true,
    availability: "now",
    summary: "Especialista em instalações elétricas residenciais.",
    serviceName: "Eletricista",
  },
  {
    position: 2,
    displayName: "Carlos Santos",
    distanceMeters: 5800,
    priceMode: "quote",
    priceFromCents: null,
    priceToCents: null,
    isVerified: false,
    availability: "schedule",
    summary: "Manutenção e reparos elétricos.",
    serviceName: "Eletricista",
  },
];

test("presents single candidate details accurately without phone numbers", () => {
  const result = presentSelectionInquiry("details", sampleCandidates, [1]);
  assert.match(result, /João Silva/);
  assert.match(result, /3,2 km/);
  assert.match(result, /R\$ 150,00/);
  assert.match(result, /Profissional verificado/);
  assert.doesNotMatch(result, /\+?\d{8,}/);
});

test("presents address inquiry truthfully without fabricating street addresses", () => {
  const result = presentSelectionInquiry("address", sampleCandidates, [1]);
  assert.match(result, /Não tenho o endereço exato/);
  assert.match(result, /3,2 km da sua localização/);
  assert.doesNotMatch(result, /Rua|Avenida|Bairro|CEP/);
});

test("presents distance comparison deterministically", () => {
  const result = presentSelectionInquiry("distance", sampleCandidates, []);
  assert.match(result, /O prestador mais próximo é \*João Silva\*/);
  assert.match(result, /3,2 km/);
  assert.match(result, /Carlos Santos \(5,8 km\)/);
});

test("presents price comparison factually with mixed price modes", () => {
  const result = presentSelectionInquiry("price", sampleCandidates, []);
  assert.match(result, /João Silva\*: R\$ 150,00/);
  assert.match(result, /Carlos Santos\*: Sob consulta/);
});

test("presents availability factually without inventing future schedules", () => {
  const result = presentSelectionInquiry("availability", sampleCandidates, [1]);
  assert.match(result, /disponível para atendimento imediato/);

  const scheduleResult = presentSelectionInquiry("availability", sampleCandidates, [2]);
  assert.match(scheduleResult, /combinados diretamente com o prestador/);
});

test("presents best recommendation / comparison neutrally without declaring subjective winner", () => {
  const result = presentSelectionInquiry("best_recommendation", sampleCandidates, []);
  assert.match(result, /Confira os detalhes dos prestadores disponíveis/);
  assert.match(result, /1\. \*João Silva\*: 3,2 km \| R\$ 150,00 \| Verificado/);
  assert.match(result, /2\. \*Carlos Santos\*: 5,8 km \| Sob consulta/);
  assert.doesNotMatch(result, /melhor opção|vencedor|nota|classificação/i);
});

test("presents unshown professional message gracefully", () => {
  const result = presentSelectionInquiry("unshown", sampleCandidates, []);
  assert.match(result, /Esse prestador não está entre as opções apresentadas/);
});

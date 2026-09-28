import { extractExplicitLocation } from "../message-interpretation/message-interpretation.location.js";
import { contextualProposalSchema, hasTrailingNonGeographicModifier, hasUnsafeRequestContext, normalizeContextualText, type ContextualProposal } from "./contextual.contract.js";

// A deliberately narrow request grammar. The catalog supplies the service and
// the existing location extractor supplies the place; this function only checks
// whether the complete utterance is a direct request for those exact facts.
const REQUEST_PREFIXES = new Set([
  "preciso de", "preciso de um", "preciso de uma", "quero", "quero um", "quero uma",
  "estou procurando", "estou procurando um", "estou procurando uma",
  "procuro", "procuro um", "procuro uma", "busco", "busco um", "busco uma",
]);
const TERMINAL_POLITENESS = /\s+por (?:favor|gentileza)\s*$/iu;

export function deterministicSearchProposal(rawText: string, serviceEvidence: string | null,
  serviceKey: string | null): ContextualProposal | null {
  if (!serviceEvidence || !serviceKey || /[?;:!.\n\r]/u.test(rawText)) return null;
  // Only these terminal courtesy phrases can be omitted for direct-request
  // eligibility. Temporal and urgency language remains with interpretation.
  const directText = rawText.replace(TERMINAL_POLITENESS, "");
  const removedPoliteness = directText !== rawText;
  const location = extractExplicitLocation(directText)?.text;
  if (!location || hasTrailingNonGeographicModifier(location)) return null;
  const text = normalizeContextualText(directText);
  if (hasUnsafeRequestContext(text)) return null;
  const evidence = normalizeContextualText(serviceEvidence);
  const place = normalizeContextualText(location);
  const marker = ` ${evidence} `;
  const padded = ` ${text} `;
  const index = padded.indexOf(marker);
  if (index < 0 || padded.indexOf(marker, index + marker.length) >= 0) return null;
  const prefix = padded.slice(1, index).trim();
  const suffix = padded.slice(index + marker.length - 1).trim();
  if (!(REQUEST_PREFIXES.has(prefix) || (prefix === "" && removedPoliteness)) || /\be\b/u.test(suffix)
    || ![`em ${place}`, `aqui em ${place}`, `na cidade de ${place}`, `no municipio de ${place}`].includes(suffix)) return null;
  const proposal = contextualProposalSchema.safeParse({ intent: "search", speech_act: "request",
    services: [{ key: serviceKey, evidence: serviceEvidence }],
    location: { text: location, evidence: location }, natural_reply: null, confidence: "high", uncertain: false });
  return proposal.success ? proposal.data : null;
}

export type SelectionFastPathResult =
  | { kind: "distance_comparison" }
  | { kind: "price_comparison" }
  | { kind: "none" };

export function deterministicSelectionFastPath(rawText: string): SelectionFastPathResult {
  const text = normalizeContextualText(rawText);
  if (!text) return { kind: "none" };

  if (
    /^(?:qual|quais)(?: e| esta)? (?:o|os)? (?:mais|menor) (?:perto|proximo|distante|distancia)\??$/u.test(text)
    || /^(?:qual|quais) (?:esta|ficam?) (?:mais|menor) (?:perto|proximo)\??$/u.test(text)
    || /^qual o mais perto\??$/u.test(text)
    || /^qual o mais proximo\??$/u.test(text)
  ) {
    return { kind: "distance_comparison" };
  }

  if (
    /^(?:qual|quais)(?: e| esta)? (?:o|os)? (?:mais|menor) (?:barato|preco|valor)\??$/u.test(text)
    || /^(?:qual|quais) (?:tem|cobram?) (?:o|os)? (?:menor|mais) (?:preco|valor|barato)\??$/u.test(text)
    || /^qual o mais barato\??$/u.test(text)
    || /^qual o menor preco\??$/u.test(text)
  ) {
    return { kind: "price_comparison" };
  }

  return { kind: "none" };
}

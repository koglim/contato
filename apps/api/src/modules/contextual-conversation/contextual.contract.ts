import { z } from "zod";
import { extractExplicitLocation } from "../message-interpretation/message-interpretation.location.js";

export const CONTEXTUAL_VERSION = "b2.4";
export const CONTEXTUAL_POLICY = Object.freeze({ maxOutputTokens: 900, maxCatalog: 100, maxCallsPerHour: 20, maxGlobalCallsPerHour: 1_000, leaseSeconds: 30 });
const speechActSchema = z.enum(["request", "information", "hypothetical", "negated", "unclear"]);
const confidenceSchema = z.enum(["high", "medium", "low"]);
const naturalReplySchema = z.string().trim().min(2).max(320).nullable();
export const contextualProposalSchema = z.object({
  intent: z.enum(["greeting", "small_talk", "search", "correct_location", "correct_service", "catalog_info", "selection", "faq_cost", "out_of_scope", "clarify"]),
  // Optional only for persisted b2.1 proposals. New model responses require this field.
  speech_act: speechActSchema.optional(),
  services: z.array(z.object({ key: z.string().max(80), evidence: z.string().min(1).max(160) }).strict()).max(3),
  location: z.object({ text: z.string().min(1).max(160), evidence: z.string().min(1).max(160) }).strict().nullable(),
  // Optional only for proposals persisted before the conversation orchestrator.
  natural_reply: naturalReplySchema.optional(),
  confidence: confidenceSchema.optional(),
  uncertain: z.boolean(),
}).strict();
export const contextualInterpretationSchema = contextualProposalSchema.extend({
  speech_act: speechActSchema,
  natural_reply: naturalReplySchema,
  confidence: confidenceSchema,
});
export type ContextualProposal = z.infer<typeof contextualProposalSchema>;
const slotSchema = z.object({ value: z.string().min(1).max(200), source: z.enum(["user_explicit", "user_confirmation", "domain"]), inboundId: z.string().uuid() }).strict();
export const contextualMemorySchema = z.object({
  conversationId: z.string().uuid().nullable(),
  service: slotSchema.nullable(), location: slotSchema.nullable(),
  hypotheses: z.array(z.object({ key: z.string().max(80), name: z.string().max(200), evidence: z.string().max(160), inboundId: z.string().uuid() }).strict()).max(3),
}).strict();
export type ContextualMemory = z.infer<typeof contextualMemorySchema>;
export const emptyMemory = (): ContextualMemory => ({ conversationId: null, service: null, location: null, hypotheses: [] });
export type ContextualCatalogItem = { key: string; name: string; description: string | null };
export type ContextualInput = { message: string; service: string | null; location: string | null; pending: string | null; hypotheses: string[]; catalog: ContextualCatalogItem[] };
export type ContextualReplyContext = { target: "service" | "location" | "service_confirmation"; services: string[]; location: string | null; reason: "missing" | "ambiguous" };
export const contextualQuestionSchema = z.object({ question: z.string().trim().min(5).max(240) }).strict();
export const contextualCompositionSchema = contextualQuestionSchema.extend({ target: z.enum(["service", "location", "service_confirmation"]) });
export function validateContextualQuestion(value: unknown, context?: ContextualReplyContext): string {
  const parsed = context ? contextualCompositionSchema.parse(value) : contextualQuestionSchema.parse(value);
  const text = parsed.question;
  if (context && (!("target" in parsed) || parsed.target !== context.target)) throw new Error("contextual_question_target_invalid");
  // Only a clarifying question may be model-written. Financial/contact/action blocks remain immutable.
  if (!text.endsWith("?") || /[\d$€£@]|https?:|\n|[.!]/iu.test(text)
    || /\b(?:encontrei|selecionei|selecionado|enviei|avisei|agendei|agendado|reservado|confirmado|garant\p{L}*|gratis|gratuito|gratuita|custa|cobro|preco|telefone|contato|pagamento|pague|pix|senha|token|disponivel|profissional)\b/u.test(normalizeContextualText(text))
    || /\b(?:vou|vamos|irei) (?:enviar|avisar|agendar|reservar)|\b(?:vai atender|chegara)\b/u.test(normalizeContextualText(text))) {
    throw new Error("contextual_question_invalid");
  }
  const normalized = normalizeContextualText(text);
  if (context && ((context.target === "service" && /\b(?:qual cidade|qual estado|qual bairro|onde voce)\b/u.test(normalized))
    || (context.target === "location" && /\b(?:qual servico|qual profissional|o que aconteceu|qual problema)\b/u.test(normalized))
    || (context.target === "service_confirmation" && !context.services.some(name => (` ${normalized} `).includes(` ${normalizeContextualText(name)} `))))) {
    throw new Error("contextual_question_grounding_invalid");
  }
  return text;
}
export interface ContextualProvider { readonly model: string; interpret(input: ContextualInput): Promise<unknown>; composeQuestion?(input: ContextualReplyContext): Promise<unknown> }
export const normalizeContextualText = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export type ContextualDecision = { kind: "delegate" | "search" | "clarify" | "greeting" | "small_talk" | "faq_cost" | "catalog_info" | "out_of_scope"; memory: ContextualMemory; correction: boolean; catalogServices?: string[]; naturalReply?: string };

export function validateNaturalReply(value: unknown): string {
  const text = z.string().trim().min(2).max(320).parse(value);
  const normalized = normalizeContextualText(text);
  // Model-written text is limited to non-transactional conversation. Anything
  // resembling private data, a quote, a professional fact or a completed action
  // is discarded in favor of deterministic copy.
  if (/https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\+?\d[\d\s().-]{7,}\d/iu.test(text)
    || /\b(?:preco|valor|custa|custo|reais|gratis|gratuito|telefone|whatsapp|contato|profissional|profissionais|distancia|quilometros?|disponivel|agenda|prazo|pagamento|pix|senha|token|api|banco de dados)\b/u.test(normalized)
    || /\b(?:encontrei|selecionei|escolhi|enviei|avisei|agendei|reservei|confirmei|cadastrei|liberei|compartilhei)\b/u.test(normalized)) {
    throw new Error("contextual_natural_reply_invalid");
  }
  return text;
}

// Proposals cannot authorize selection, consent, ranking or disclosure. Those use the original message.
export function controlContextualProposal(raw: string, inboundId: string, value: unknown, memory: ContextualMemory, catalog: ContextualCatalogItem[], explicitService: string | null): ContextualDecision {
  const proposal = contextualProposalSchema.parse(value);
  const next = structuredClone(memory);
  const text = normalizeContextualText(raw);
  const explicitLocation = extractExplicitLocation(raw)?.text ?? null;
  const evidenceExists = (evidence: string) => (` ${text} `).includes(` ${normalizeContextualText(evidence)} `);
  if (proposal.intent === "selection") return { kind: "delegate", memory, correction: false };
  const safeNaturalReply = () => {
    if (!proposal.natural_reply) return undefined;
    try { return validateNaturalReply(proposal.natural_reply); } catch { return undefined; }
  };
  if (proposal.confidence === "low") return { kind: "clarify", memory, correction: false };
  if (proposal.intent === "greeting" || proposal.intent === "small_talk") {
    return { kind: proposal.intent, memory, correction: false, naturalReply: safeNaturalReply() };
  }
  if (proposal.intent === "faq_cost") return { kind: proposal.intent, memory, correction: false };
  if (proposal.intent === "out_of_scope") return { kind: proposal.intent, memory, correction: false, naturalReply: safeNaturalReply() };
  if (proposal.intent === "clarify" || proposal.uncertain) return { kind: "clarify", memory, correction: false, naturalReply: safeNaturalReply() };
  if (proposal.speech_act && proposal.speech_act !== "request" && proposal.speech_act !== "information") return { kind: "clarify", memory, correction: false };
  // A negated defect ("a descarga não para") is not a refusal ("não quero").
  // These are defense-in-depth checks, not the primary intent classifier or a phrase allowlist.
  if (/\b(?:se precisar|talvez|nao (?:quero|preciso|autorizo|confirme|selecione)|ignore|prompt)\b/u.test(text)) return { kind: "clarify", memory, correction: false };
  if (proposal.services.some(item => !catalog.some(c => c.key === item.key) || !evidenceExists(item.evidence))
    || (proposal.location && (!evidenceExists(proposal.location.evidence) || (!explicitLocation && !evidenceExists(proposal.location.text))))) {
    return { kind: "clarify", memory, correction: false };
  }
  if (proposal.intent === "catalog_info") {
    return { kind: "catalog_info", memory, correction: false, catalogServices: [...new Set(proposal.services.map(item => catalog.find(c => c.key === item.key)!.name))] };
  }
  // Informational questions never grant permission for a new search, even if service/city are mentioned.
  if (proposal.speech_act === "information") return { kind: "clarify", memory, correction: false };
  if (!proposal.services.length && !proposal.location && !explicitService && !explicitLocation) return { kind: "clarify", memory, correction: false };
  // explicitService is already backed by an exact/phrase catalogue term found
  // in the original message. The canonical display name need not be literal:
  // "tomada" is valid domain evidence for "Eletricista".
  if (explicitService && !catalog.some(item => item.name === explicitService)) return { kind: "clarify", memory, correction: false };
  // A proposed semantic mapping remains a hypothesis until the customer confirms it.
  if (explicitService) {
    next.service = { value: explicitService, source: "user_explicit", inboundId };
    next.hypotheses = [];
  } else if (proposal.services.length) {
    next.hypotheses = proposal.services.map(item => ({ ...item, name: catalog.find(c => c.key === item.key)!.name, inboundId }));
  }
  if (explicitLocation || proposal.location) next.location = { value: explicitLocation ?? proposal.location!.text, source: "user_explicit", inboundId };
  const correction = (proposal.intent === "correct_location" && proposal.location !== null) || proposal.intent === "correct_service";
  return { kind: next.hypotheses.length ? "clarify" : "search", memory: next, correction };
}

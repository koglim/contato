import { z } from "zod";

export const CONTEXTUAL_VERSION = "b2.1";
export const CONTEXTUAL_POLICY = Object.freeze({ timeoutMs: 6_000, maxOutputTokens: 900, maxCatalog: 100, maxCallsPerHour: 20, maxGlobalCallsPerHour: 1_000, leaseSeconds: 30 });
export const contextualProposalSchema = z.object({
  intent: z.enum(["search", "correct_location", "selection", "faq_cost", "out_of_scope", "clarify"]),
  services: z.array(z.object({ key: z.string().max(80), evidence: z.string().min(1).max(160) }).strict()).max(3),
  location: z.object({ text: z.string().min(1).max(160), evidence: z.string().min(1).max(160) }).strict().nullable(),
  uncertain: z.boolean(),
}).strict();
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
export interface ContextualProvider { readonly model: string; interpret(input: ContextualInput): Promise<unknown> }
export const normalizeContextualText = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export type ContextualDecision = { kind: "delegate" | "search" | "clarify" | "faq_cost" | "out_of_scope"; memory: ContextualMemory; correction: boolean };

// Proposals cannot authorize selection, consent, ranking or disclosure. Those use the original message.
export function controlContextualProposal(raw: string, inboundId: string, value: unknown, memory: ContextualMemory, catalog: ContextualCatalogItem[], explicitService: string | null): ContextualDecision {
  const proposal = contextualProposalSchema.parse(value);
  const next = structuredClone(memory);
  const text = normalizeContextualText(raw);
  const evidenceExists = (evidence: string) => (` ${text} `).includes(` ${normalizeContextualText(evidence)} `);
  if (proposal.intent === "selection") return { kind: "delegate", memory, correction: false };
  if (proposal.intent === "faq_cost" || proposal.intent === "out_of_scope") return { kind: proposal.intent, memory, correction: false };
  if (proposal.intent === "clarify" || proposal.uncertain) return { kind: "clarify", memory, correction: false };
  if (!proposal.services.length && !proposal.location && !explicitService) return { kind: "clarify", memory, correction: false };
  if (/\?|\b(?:se|talvez|nao|ignore|prompt|instrucoes|sistema)\b/u.test(raw.includes("?") ? "?" : text)) return { kind: "clarify", memory, correction: false };
  if (proposal.services.some(item => !catalog.some(c => c.key === item.key) || !evidenceExists(item.evidence))
    || (proposal.location && (!evidenceExists(proposal.location.evidence) || !evidenceExists(proposal.location.text)))) {
    return { kind: "clarify", memory, correction: false };
  }
  // A proposed semantic mapping remains a hypothesis until the customer confirms it.
  if (explicitService) {
    next.service = { value: explicitService, source: "user_explicit", inboundId };
    next.hypotheses = [];
  } else if (proposal.services.length) {
    next.hypotheses = proposal.services.map(item => ({ ...item, name: catalog.find(c => c.key === item.key)!.name, inboundId }));
  }
  if (proposal.location) next.location = { value: proposal.location.text, source: "user_explicit", inboundId };
  const correction = proposal.intent === "correct_location" && proposal.location !== null;
  return { kind: next.hypotheses.length ? "clarify" : "search", memory: next, correction };
}

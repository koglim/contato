import { normalizeContextualText, type ContextualMemory } from "./contextual.contract.js";
import type { ServiceResolutionRepository } from "../service-resolution/service-resolution.types.js";

type Hypothesis = ContextualMemory["hypotheses"][number];
const BARE_CONFIRMATION = new Set(["sim", "isso", "isso mesmo", "confirmo"]);
const AFFIRMATIVE_PREFIX = /^(sim|isso(?: mesmo)?|confirmo) (.+)$/u;

// Confirm only the sole, already-grounded catalog hypothesis. Requiring the
// entire remaining utterance to be its canonical name prevents another service,
// a conditional, or unrelated discourse from being consumed as confirmation.
export function confirmedUniqueHypothesis(rawText: string, hypotheses: Hypothesis[]):
  { hypothesis: Hypothesis; explicitService: boolean } | null {
  if (hypotheses.length !== 1 || /[?¿\n\r]/u.test(rawText)) return null;
  const normalized = normalizeContextualText(rawText);
  const hypothesis = hypotheses[0]!;
  if (BARE_CONFIRMATION.has(normalized)) return { hypothesis, explicitService: false };
  const affirmative = AFFIRMATIVE_PREFIX.exec(normalized);
  if (!affirmative) return null;
  const name = normalizeContextualText(hypothesis.name);
  if (!name) return null;
  const clause = affirmative[2];
  return clause === name || clause === `preciso de ${name}` || clause === `e ${name}`
    ? { hypothesis, explicitService: true } : null;
}

// Only whole-utterance refusals are eligible. Keep punctuation long enough to
// distinguish "nao preciso de X" from "nao, preciso de X" (a correction).
// The catalogue resolver below must still prove that the extracted term names
// exactly the sole hypothesis; a service mentioned inside other discourse is
// not by itself a rejection.
export async function rejectedUniqueHypothesis(rawText: string, hypotheses: Hypothesis[], services: ServiceResolutionRepository):
  Promise<{ hypothesis: Hypothesis; method: "exact" | "phrase" } | null> {
  if (hypotheses.length !== 1 || /[?\u00bf\n\r]/u.test(rawText)) return null;
  const folded = rawText.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim()
    .replace(/[.!]+$/u, "").trim().replace(/\s+/gu, " ");
  const serviceText = /^nao, (.+?) nao$/u.exec(folded)?.[1]
    ?? /^nao e (.+)$/u.exec(folded)?.[1]
    ?? /^nao preciso de (.+)$/u.exec(folded)?.[1]
    ?? /^nao quero (.+)$/u.exec(folded)?.[1]
    ?? /^(.+?) nao$/u.exec(folded)?.[1];
  if (!serviceText || /[,;:!?]/u.test(serviceText)) return null;
  const resolved = await services.resolve({ text: serviceText });
  if (resolved.status !== "resolved" || !resolved.match || resolved.match.method === "fuzzy"
    || resolved.match.service.slug !== hypotheses[0]!.key) return null;
  const candidate = normalizeContextualText(serviceText);
  const term = normalizeContextualText(resolved.match.matched_term);
  return candidate === term || ["o", "a", "um", "uma"].some(article => candidate === `${article} ${term}`)
    ? { hypothesis: hypotheses[0]!, method: resolved.match.method } : null;
}

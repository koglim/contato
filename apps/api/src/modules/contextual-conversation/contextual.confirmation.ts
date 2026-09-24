import { normalizeContextualText, type ContextualMemory } from "./contextual.contract.js";

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

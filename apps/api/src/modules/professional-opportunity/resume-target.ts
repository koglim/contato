import { normalizeOpportunityCommand } from "./professional-opportunity.parser.js";

export function resolveResumeTarget<T extends { service_text: string; public_code: string | null }>(
  targets: T[], codes: string[], service: string,
): T | null {
  const requested = normalizeOpportunityCommand(service);
  const candidates = targets.filter((target) => codes.length
    ? codes.length === 1 && target.public_code === codes[0]
    : !requested || ` ${normalizeOpportunityCommand(target.service_text)} `.includes(` ${requested} `));
  return candidates.length === 1 ? candidates[0] : null;
}

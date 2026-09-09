export type OpportunityDecision = "accepted" | "declined";

export function normalizeOpportunityCommand(raw: string) {
  return raw.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[.,!;:]/gu, " ").replace(/\s+/gu, " ").trim();
}

export function parseOpportunityMessage(raw: string) {
  const codes = [...new Set((raw.match(/\bCC-[A-Z0-9]{6,12}\b/giu) ?? []).map((code) => code.toUpperCase()))];
  const text = normalizeOpportunityCommand(raw.replace(/\bCC-[A-Z0-9]{6,12}\b/giu, ""));
  const bare = text.replace(/\s+(?:a|o|a oportunidade|o codigo)$/u, "").trim();
  let decision: OpportunityDecision | null = null;
  if (!raw.includes("?") && codes.length <= 1) {
    if (["aceito", "posso atender", "vou atender", "sim consigo", "sim posso atender", "confirmo o atendimento"].includes(bare)) decision = "accepted";
    if (["nao posso atender", "recuso", "nao tenho disponibilidade", "nao consigo hoje", "nao vou conseguir atender"].includes(bare)) decision = "declined";
  }
  const resume = !raw.includes("?") && /^(?:quero voltar para|voltar para|quero retomar|retomar|quero voltar|voltar)(?:\s+(.*))?$/u.exec(text);
  const keep = !raw.includes("?") && ["manter atual", "continuar aqui", "continuar a busca atual", "quero manter a atual"].includes(text);
  return { codes, decision, resume: resume ? (resume[1] ?? "").replace(/^(?:a busca de|a busca|a|o)\s+/u, "").trim() : null, keep };
}

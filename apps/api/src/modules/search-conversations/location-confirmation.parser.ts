export type LocationConfirmationDecision =
  | { kind: "confirm" }
  | { kind: "decline" }
  | { kind: "ambiguous" };

export function parseLocationConfirmation(raw: string): LocationConfirmationDecision {
  if (raw.includes("?")) return { kind: "ambiguous" };
  const text = raw.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .trim().replace(/[.!]+$/u, "").replace(/\s+/gu, " ").trim();

  const affirmative = new Set([
    "sim", "s", "isso", "isso mesmo", "mesmo lugar", "pode ser", "com certeza", "confirmo",
    "correto", "exato", "pode", "sim por favor", "e", "eh", "positivo",
    "isso ai", "claro", "pode sim", "sim pode", "confirma",
  ]);
  if (affirmative.has(text)) {
    return { kind: "confirm" };
  }

  const negative = new Set([
    "nao", "n", "outra", "outro lugar", "mudar", "mudar localizacao", "mudar lugar",
    "trocar", "nao e", "errado", "outra cidade", "nao quero", "outro", "nem pensar", "troca",
  ]);
  if (negative.has(text)) {
    return { kind: "decline" };
  }

  return { kind: "ambiguous" };
}

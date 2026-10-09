export type LocationConfirmationDecision =
  | { kind: "confirm" }
  | { kind: "decline" }
  | { kind: "ambiguous" };

export function parseLocationConfirmation(raw: string): LocationConfirmationDecision {
  if (raw.includes("?")) return { kind: "ambiguous" };
  const text = raw.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .trim().replace(/[.!]+$/u, "").replace(/\s+/gu, " ").trim();

  const affirmative = [
    "sim", "s", "isso", "isso mesmo", "pode ser", "com certeza", "confirmo",
    "correto", "exato", "pode", "sim por favor", "e", "eh", "positivo",
    "isso ai", "isso ai!", "claro", "pode sim", "sim pode", "confirma",
  ];
  if (affirmative.includes(text)) {
    return { kind: "confirm" };
  }

  const negative = [
    "nao", "n", "outra", "outro lugar", "mudar", "trocar", "nao e",
    "errado", "outra cidade", "nao quero", "outro", "nem pensar", "troca",
  ];
  if (negative.includes(text)) {
    return { kind: "decline" };
  }

  return { kind: "ambiguous" };
}

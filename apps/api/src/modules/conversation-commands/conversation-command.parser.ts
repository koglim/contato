import type {
  GlobalConversationCommand,
  SelectionConversationCommand,
} from "./conversation-command.types.js";

const GLOBAL_COMMANDS: ReadonlyMap<string, GlobalConversationCommand["kind"]> = new Map([
  ["cancelar", "cancel"],
  ["cancela", "cancel"],
  ["parar", "cancel"],
  ["encerrar", "cancel"],
  ["recomecar", "restart"],
  ["comecar novamente", "restart"],
  ["nova busca", "restart"],
  ["ajuda", "help"],
  ["preciso de ajuda", "help"],
  ["nao entendi", "help"],
]);

export const SHOW_MORE_COMMANDS = new Set([
  "mais",
  "mais opcoes",
  "ver mais",
  "quero ver mais",
  "mostrar mais",
  "outras opcoes",
  "tem mais",
  "tem mais opcoes",
  "mostra outros",
  "mostrar outros",
  "me mostra outros",
  "nao quero nenhum desses",
]);

const ORDINAL_POSITIONS: ReadonlyMap<string, number> = new Map([
  ["primeiro", 1],
  ["primeira", 1],
  ["segundo", 2],
  ["segunda", 2],
  ["terceiro", 3],
  ["terceira", 3],
  ["quarto", 4],
  ["quarta", 4],
  ["quinto", 5],
  ["quinta", 5],
  ["sexto", 6],
  ["sexta", 6],
  ["setimo", 7],
  ["setima", 7],
  ["oitavo", 8],
  ["oitava", 8],
  ["nono", 9],
  ["nona", 9],
  ["decimo", 10],
  ["decima", 10],
]);

const CARDINAL_POSITIONS: ReadonlyMap<string, number> = new Map([
  ["um", 1],
  ["uma", 1],
  ["dois", 2],
  ["duas", 2],
  ["tres", 3],
  ["quatro", 4],
  ["cinco", 5],
  ["seis", 6],
  ["sete", 7],
  ["oito", 8],
  ["nove", 9],
  ["dez", 10],
]);

function normalizeForCommandComparison(rawText: string) {
  return rawText
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/gu, " ")
    .replace(/[.!?,;:]+$/u, "")
    .trim();
}

export function parseGlobalConversationCommand(rawText: string): GlobalConversationCommand | null {
  const kind = GLOBAL_COMMANDS.get(normalizeForCommandComparison(rawText));
  return kind ? { kind } : null;
}

export function parseSelectionConversationCommand(rawText: string): SelectionConversationCommand | null {
  const normalizedText = normalizeForCommandComparison(rawText);
  if (SHOW_MORE_COMMANDS.has(normalizedText)) return { kind: "show_more" };

  const ordinalPosition = ORDINAL_POSITIONS.get(normalizedText);
  if (ordinalPosition !== undefined) return { kind: "select_match", position: ordinalPosition };

  const ordinalPhrase = /^quero [oa] (.+)$/u.exec(normalizedText);
  const phrasedOrdinalPosition = ordinalPhrase ? ORDINAL_POSITIONS.get(ordinalPhrase[1]) : undefined;
  if (phrasedOrdinalPosition !== undefined) return { kind: "select_match", position: phrasedOrdinalPosition };

  const cardinalOption = /^(?:quero a )?opcao (\p{L}+)$/u.exec(normalizedText);
  const cardinalPosition = cardinalOption ? CARDINAL_POSITIONS.get(cardinalOption[1]) : undefined;
  if (cardinalPosition !== undefined) return { kind: "select_match", position: cardinalPosition };

  const match = /^(?:quero a opcao |opcao )?(10|[1-9])$/u.exec(normalizedText);
  if (!match) return null;

  return { kind: "select_match", position: Number(match[1]) };
}

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

const SHOW_MORE_COMMANDS = new Set([
  "mais",
  "ver mais",
  "mostrar mais",
  "outras opcoes",
]);

const ORDINAL_POSITIONS: ReadonlyMap<string, number> = new Map([
  ["primeiro", 1],
  ["primeira", 1],
  ["segundo", 2],
  ["segunda", 2],
  ["terceiro", 3],
  ["terceira", 3],
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

  const match = /^(?:quero a opcao |opcao )?(10|[1-9])$/u.exec(normalizedText);
  if (!match) return null;

  return { kind: "select_match", position: Number(match[1]) };
}

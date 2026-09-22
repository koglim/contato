import type { ExplicitLocation } from "./message-interpretation.types.js";

const LOCATION_WORD = String.raw`\p{L}[\p{L}\p{M}'’.-]*`;
const LOCATION_NAME = String.raw`${LOCATION_WORD}(?:\s+${LOCATION_WORD})*`;
const LOCATION_VALUE = new RegExp(String.raw`^(${LOCATION_NAME})(?:\s*,\s*([A-Za-z]{2}))?$`, "u");
const UNSAFE_TRAILING_CONTEXT = /(?:\s+para\s+(?:hoje|amanh[ãa])(?:\s|$)|\s+(?:e\s+)?(?:preciso|quero|necessito|busco|procuro)\b)/iu;
const EXPLICIT_MARKERS = [
  /\baqui\s+em\s+/giu,
  /\bna\s+cidade\s+de\s+/giu,
  /\bno\s+munic[ií]pio\s+de\s+/giu,
];
const OBVIOUSLY_GENERIC = new Set(["casa", "casa mesmo", "minha casa", "trabalho", "empresa", "meu apartamento", "apartamento"]);
const NON_LOCATION_PREFIX = /\b(?:problema|reparo|ajuda|manuten[cç][aã]o|instala[cç][aã]o|vazamento|defeito)\s*$/iu;

function removeTerminalPunctuation(value: string) {
  return value.trim().replace(/[.!?]+$/u, "").replace(/,\s*$/u, "").trim();
}

function normalizeForComparison(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR");
}

function validLocation(value: string, requireState = false) {
  const cleaned = removeTerminalPunctuation(value);
  if (UNSAFE_TRAILING_CONTEXT.test(cleaned)) return null;
  const match = LOCATION_VALUE.exec(cleaned);
  if (!match || (requireState && !match[2])) return null;
  const text = match[2] ? `${match[1]}, ${match[2].toUpperCase()}` : match[1];
  return OBVIOUSLY_GENERIC.has(normalizeForComparison(text)) ? null : text;
}

function lastMarkerEnd(text: string, pattern: RegExp) {
  pattern.lastIndex = 0;
  let end: number | null = null;
  for (const match of text.matchAll(pattern)) end = match.index + match[0].length;
  return end;
}

export function extractExplicitLocation(rawText: string): ExplicitLocation | null {
  for (const marker of EXPLICIT_MARKERS) {
    const end = lastMarkerEnd(rawText, marker);
    if (end !== null) {
      const text = validLocation(rawText.slice(end));
      if (text) return { text, strategy: "locative_phrase" };
    }
  }

  // A city without its UF is still a useful candidate. The geocoder—not this
  // lexical extractor—decides whether it exists or is geographically ambiguous.
  const generic = /\bem\s+(.+)$/iu.exec(rawText);
  const text = generic && !NON_LOCATION_PREFIX.test(rawText.slice(0, generic.index)) ? validLocation(generic[1]) : null;
  return text ? { text, strategy: "locative_phrase" } : null;
}

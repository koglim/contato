import type { SelectionMatchRecord } from "../match-selection/match-selection.types.js";

export type ProfessionalSelectionResolution =
  | { kind: "selected"; position: number }
  | { kind: "ambiguous"; options: Array<{ position: number; professionalDisplayName: string }> }
  | { kind: "unresolved" };

function normalize(value: string) {
  return value
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function containsPhrase(text: string, phrase: string) {
  return (` ${text} `).includes(` ${phrase} `);
}

const FILLER_WORDS = new Set([
  "a", "o", "as", "os", "com", "de", "do", "da", "e", "eu", "fique", "fico",
  "for", "favor", "me", "minha", "meu", "na", "no", "opcao", "opcoes", "pode", "ser",
  "um", "uma", "vou", "quero", "escolho", "escolher",
]);

function hasNonAffirmativeIntent(rawText: string, normalizedText: string) {
  if (rawText.includes("?")) return true;
  if (/^(quanto|qual|quais|como|quando|onde|quem)\b/u.test(normalizedText)) return true;
  if (/\bnao\b/u.test(normalizedText)) return true;
  if (/^se\b/u.test(normalizedText)) return true;
  return false;
}

function phraseTokenRange(tokens: string[], phraseTokens: string[]) {
  for (let index = 0; index <= tokens.length - phraseTokens.length; index += 1) {
    if (phraseTokens.every((token, offset) => tokens[index + offset] === token)) return [index, index + phraseTokens.length - 1] as const;
  }
  return null;
}

function isBareFirstNameReference(normalizedText: string, firstName: string, fullNames: string[]) {
  const tokens = normalizedText.split(" ");
  const firstNameTokens = firstName.split(" ");
  const consumedRanges = fullNames
    .map((name) => phraseTokenRange(tokens, name.split(" ")))
    .filter((range): range is readonly [number, number] => range !== null);

  for (let index = 0; index <= tokens.length - firstNameTokens.length; index += 1) {
    if (!firstNameTokens.every((token, offset) => tokens[index + offset] === token)) continue;
    const end = index + firstNameTokens.length - 1;
    if (consumedRanges.some(([start, finish]) => start <= index && finish >= end)) continue;
    const previous = tokens[index - 1];
    const next = tokens[end + 1];
    if (previous && !FILLER_WORDS.has(previous)) continue;
    if (next && !FILLER_WORDS.has(next)) continue;
    return true;
  }
  return false;
}

function countStandalonePhrase(text: string, phrase: string) {
  const tokens = text.split(" ");
  const phraseTokens = phrase.split(" ");
  let count = 0;
  for (let index = 0; index <= tokens.length - phraseTokens.length; index += 1) {
    if (phraseTokens.every((token, offset) => tokens[index + offset] === token)) count += 1;
  }
  return count;
}

function hasPositionReference(normalizedText: string) {
  return /\b(?:opcao|opcoes|primeiro|primeira|segundo|segunda|terceiro|terceira|um|uma|dois|duas|[1-9]|10)\b/u.test(normalizedText);
}

export function resolveProfessionalSelection(
  rawText: string,
  shownMatches: Pick<SelectionMatchRecord, "rankPosition" | "displayName">[],
): ProfessionalSelectionResolution {
  const normalizedText = normalize(rawText);
  if (!normalizedText) return { kind: "unresolved" };
  if (hasNonAffirmativeIntent(rawText, normalizedText)) return { kind: "unresolved" };

  const matches = shownMatches
    .filter((match): match is typeof match & { rankPosition: number } => match.rankPosition !== null)
    .map((match) => ({
      position: match.rankPosition,
      displayName: match.displayName,
      normalizedName: normalize(match.displayName),
    }));

  const fullNameMatches = matches.filter((match) => containsPhrase(normalizedText, match.normalizedName));
  const maximalFullNameMatches = fullNameMatches.filter((match) => !fullNameMatches.some((other) =>
    other !== match && other.normalizedName.length > match.normalizedName.length
    && containsPhrase(other.normalizedName, match.normalizedName)));
  const fullNameFirstNames = new Set(maximalFullNameMatches.map((match) => match.normalizedName.split(" ")[0]));
  const identified = matches.filter((match) => {
    if (maximalFullNameMatches.includes(match)) return true;
    const firstName = match.normalizedName.split(" ")[0];
    return !fullNameFirstNames.has(firstName)
      && containsPhrase(normalizedText, firstName)
      && isBareFirstNameReference(normalizedText, firstName, maximalFullNameMatches.map((full) => full.normalizedName));
  });

  if (hasPositionReference(normalizedText) && identified.length > 0) return { kind: "ambiguous", options: identified.map((match) => ({ position: match.position, professionalDisplayName: match.displayName })) };

  for (const firstName of fullNameFirstNames) {
    if (countStandalonePhrase(normalizedText, firstName) > 1) {
      const sameFirstName = matches.filter((match) => match.normalizedName.split(" ")[0] === firstName);
      if (sameFirstName.length > 1) {
        return {
          kind: "ambiguous",
          options: sameFirstName.sort((left, right) => left.position - right.position).map((match) => ({ position: match.position, professionalDisplayName: match.displayName })),
        };
      }
      return { kind: "unresolved" };
    }
  }

  const unique = new Map(identified.map((match) => [match.position, match]));
  if (unique.size === 1) return { kind: "selected", position: [...unique.values()][0]!.position };
  if (unique.size > 1) {
    return {
      kind: "ambiguous",
      options: [...unique.values()]
        .sort((left, right) => left.position - right.position)
        .map((match) => ({ position: match.position, professionalDisplayName: match.displayName })),
    };
  }
  return { kind: "unresolved" };
}

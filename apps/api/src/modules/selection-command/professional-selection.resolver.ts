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

export function resolveProfessionalSelection(
  rawText: string,
  shownMatches: Pick<SelectionMatchRecord, "rankPosition" | "displayName">[],
): ProfessionalSelectionResolution {
  const normalizedText = normalize(rawText);
  if (!normalizedText) return { kind: "unresolved" };

  const matches = shownMatches
    .filter((match): match is typeof match & { rankPosition: number } => match.rankPosition !== null)
    .map((match) => ({
      position: match.rankPosition,
      displayName: match.displayName,
      normalizedName: normalize(match.displayName),
    }));

  const fullNameMatches = matches.filter((match) => containsPhrase(normalizedText, match.normalizedName));
  const fullNameFirstNames = new Set(fullNameMatches.map((match) => match.normalizedName.split(" ")[0]));
  const identified = matches.filter((match) => {
    if (fullNameMatches.includes(match)) return true;
    const firstName = match.normalizedName.split(" ")[0];
    return !fullNameFirstNames.has(firstName) && containsPhrase(normalizedText, firstName);
  });

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

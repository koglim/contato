/** Produces the same canonical form used by the catalog seed for aliases. */
export function normalizeServiceText(text: string) {
  return text
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

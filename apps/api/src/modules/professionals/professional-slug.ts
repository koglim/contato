export function professionalSlugBase(value: string) {
  const slug = value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  return slug || "professional";
}
export function professionalSlugCandidate(base: string, suffix: number) {
  return suffix === 1 ? base : `${base}-${suffix}`;
}

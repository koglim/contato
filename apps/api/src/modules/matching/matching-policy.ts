// Internal product limits: transport inputs never control the persisted pool.
export const CANDIDATE_POOL_SIZE = 20;
export const PRESENTATION_PAGE_SIZE = 3;
export const MAX_PRESENTED_PER_SEARCH = 6;

export function presentationPageSize(requested = PRESENTATION_PAGE_SIZE): number {
  return Number.isInteger(requested) && requested > 0
    ? Math.min(requested, PRESENTATION_PAGE_SIZE)
    : PRESENTATION_PAGE_SIZE;
}

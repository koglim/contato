import type { ServiceResolutionInput, ServiceResolutionResponse } from "@contatocerto/shared";

export const FUZZY_MIN_TERM_LENGTH = 5;
export const FUZZY_SIMILARITY_THRESHOLD = 0.72;
export const FUZZY_AMBIGUITY_GAP = 0.05;

export type ServiceResolutionRepository = {
  resolve(input: ServiceResolutionInput): Promise<ServiceResolutionResponse>;
};

import type { ServiceResolutionInput, ServiceResolutionResponse } from "@contatocerto/shared";

export const FUZZY_MIN_TERM_LENGTH = 5;

export type ServiceResolutionRepository = {
  resolve(input: ServiceResolutionInput): Promise<ServiceResolutionResponse>;
};

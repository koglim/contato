import type { MessageInterpretationInput, MessageInterpretationResponse } from "@contatocerto/shared";
import { extractExplicitLocation } from "./message-interpretation.location.js";
import type { MessageInterpretationService } from "./message-interpretation.types.js";

export class DeterministicMessageInterpreter implements MessageInterpretationService {
  interpret(input: MessageInterpretationInput): MessageInterpretationResponse {
    const location = extractExplicitLocation(input.raw_text);
    if (!location) {
      return {
        status: "needs_location",
        raw_text: input.raw_text,
        service_text: input.raw_text,
        location_text: null,
        country_code: input.country_code,
        interpretation: { service_strategy: "full_message", location_strategy: "none" },
      };
    }
    return {
      status: "interpreted",
      raw_text: input.raw_text,
      service_text: input.raw_text,
      location_text: location.text,
      country_code: input.country_code,
      interpretation: { service_strategy: "full_message", location_strategy: location.strategy },
    };
  }
}

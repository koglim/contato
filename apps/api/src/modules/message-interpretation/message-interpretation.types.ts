import type { MessageInterpretationInput, MessageInterpretationResponse } from "@contatocerto/shared";

export type MessageInterpretationService = {
  interpret(input: MessageInterpretationInput): MessageInterpretationResponse;
};

export type ExplicitLocation = {
  text: string;
  strategy: "locative_phrase";
};

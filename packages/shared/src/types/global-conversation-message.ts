import type { z } from "zod";
import type { globalConversationMessageContractSchema } from "../schemas/global-conversation-message.js";

export type GlobalConversationMessageContract = z.infer<typeof globalConversationMessageContractSchema>;

import type { GlobalConversationMessageContract } from "@contatocerto/shared";
import type { GlobalConversationCommandOutcome } from "./global-conversation-command.types.js";

function assertNever(value: never): never {
  throw new Error(`Unsupported global conversation command outcome: ${String(value)}`);
}

export function mapGlobalConversationCommandOutcome(
  outcome: GlobalConversationCommandOutcome,
): GlobalConversationMessageContract {
  switch (outcome.kind) {
    case "cancelled":
    case "restarted":
    case "no_active_conversation":
      return { kind: outcome.kind };
    case "help":
      return { kind: "help", pending_slot: outcome.pendingSlot };
    default:
      return assertNever(outcome);
  }
}

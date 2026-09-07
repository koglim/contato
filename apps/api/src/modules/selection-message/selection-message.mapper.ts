import type { SelectionMessageContract } from "@contatocerto/shared";
import type { SelectionCommandOutcome } from "../selection-command/selection-command.types.js";

function assertNever(value: never): never {
  throw new Error(`Unsupported selection command outcome: ${String(value)}`);
}

export function mapSelectionCommandOutcome(outcome: SelectionCommandOutcome): SelectionMessageContract {
  switch (outcome.kind) {
    case "selected":
      return {
        kind: "selected",
        professional_name: outcome.professionalDisplayName,
        service_name: outcome.serviceName,
        professional_phone_e164: outcome.professionalPhoneE164,
      };
    case "invalid_selection":
      return {
        kind: "invalid_selection",
        requested_position: outcome.requestedPosition,
        visible_match_count: outcome.visibleMatchCount,
      };
    case "not_command":
      return { kind: "not_command" };
    case "show_more_requested":
      return outcome.hasMore
        ? { kind: "show_more_requested", shown_match_count: outcome.shownMatchCount }
        : { kind: "no_more_options" };
    case "global_command":
      return { kind: "global_command", command: outcome.command.kind };
    case "conversation_not_found":
    case "conversation_not_active":
    case "conversation_expired":
    case "conversation_customer_mismatch":
    case "search_request_not_selectable":
    case "match_not_available":
    case "idempotency_conflict":
      return { kind: "selection_unavailable", reason: outcome.kind };
    case "invalid_context":
      return { kind: "selection_unavailable", reason: outcome.reason };
    default:
      return assertNever(outcome);
  }
}

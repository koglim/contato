import type {
  GlobalConversationCommandInput,
  GlobalConversationCommandOutcome,
  GlobalConversationCommandRepository,
  GlobalConversationCommandService,
} from "./global-conversation-command.types.js";

export class DefaultGlobalConversationCommandService implements GlobalConversationCommandService {
  constructor(private readonly repository: GlobalConversationCommandRepository) {}

  async execute(input: GlobalConversationCommandInput): Promise<GlobalConversationCommandOutcome> {
    switch (input.command.kind) {
      case "cancel": {
        const cancelled = await this.repository.cancelActiveByCustomerId(input.customerId);
        return cancelled ? { kind: "cancelled" } : { kind: "no_active_conversation" };
      }
      case "restart":
        await this.repository.cancelActiveByCustomerId(input.customerId);
        return { kind: "restarted" };
      case "help": {
        const active = await this.repository.findActiveByCustomerId(input.customerId);
        return { kind: "help", pendingSlot: active?.pendingSlot ?? null };
      }
    }
  }
}

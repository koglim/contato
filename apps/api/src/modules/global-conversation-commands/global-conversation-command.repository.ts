import type { QueryResultRow } from "pg";
import { query, type SqlValue } from "../../database/connection.js";
import type {
  ActiveGlobalConversation,
  GlobalConversationCommandRepository,
} from "./global-conversation-command.types.js";
import type { SearchConversationPendingSlot } from "../search-conversations/search-conversation.types.js";

type ActiveConversationRow = {
  id: string;
  pending_slot: SearchConversationPendingSlot;
};

export type GlobalConversationCommandQuery = <T extends QueryResultRow>(
  text: string,
  values?: SqlValue[],
) => Promise<{ rows: T[] }>;

function toActiveConversation(row: ActiveConversationRow): ActiveGlobalConversation {
  return { id: row.id, pendingSlot: row.pending_slot };
}

export class PostgresGlobalConversationCommandRepository implements GlobalConversationCommandRepository {
  constructor(private readonly execute: GlobalConversationCommandQuery = query) {}

  async findActiveByCustomerId(customerId: string) {
    const result = await this.execute<ActiveConversationRow>(
      `SELECT id, pending_slot
         FROM search_conversations
        WHERE customer_id = $1
          AND status = 'active'
          AND pending_slot IS NOT NULL
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1`,
      [customerId],
    );
    return result.rows[0] ? toActiveConversation(result.rows[0]) : null;
  }

  async cancelActiveByCustomerId(customerId: string) {
    const result = await this.execute<ActiveConversationRow>(
      `WITH active_conversation AS (
         SELECT id, pending_slot
           FROM search_conversations
          WHERE customer_id = $1
            AND status = 'active'
            AND pending_slot IS NOT NULL
            AND expires_at > NOW()
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE
       )
       UPDATE search_conversations
          SET status = 'cancelled',
              pending_slot = NULL,
              processing_token = NULL,
              processing_started_at = NULL
         FROM active_conversation
        WHERE search_conversations.id = active_conversation.id
          AND search_conversations.status = 'active'
       RETURNING active_conversation.id, active_conversation.pending_slot`,
      [customerId],
    );
    return result.rows[0] ? toActiveConversation(result.rows[0]) : null;
  }
}

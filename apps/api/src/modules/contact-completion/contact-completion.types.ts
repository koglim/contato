import type {
  ContactCompletionState,
  ContactCompletionActorRole,
  ContactCompletionAction,
  ContactCompletionCommand,
  ContactCompletionRecord,
  ContactCompletionEventRecord,
  ContactCompletionMessage,
} from "@contatocerto/shared";
import type { DatabaseClient } from "../../database/connection.js";

export type {
  ContactCompletionState,
  ContactCompletionActorRole,
  ContactCompletionAction,
  ContactCompletionCommand,
  ContactCompletionRecord,
  ContactCompletionEventRecord,
  ContactCompletionMessage,
};

export type ContactRow = {
  id: string;
  customer_id: string;
  professional_id: string;
  search_request_id: string;
  selection_conversation_id: string;
  public_code: string;
  status: string;
  bilateral_snapshot: unknown;
};

export type ContactCompletionRow = {
  id: string;
  contact_id: string;
  state: ContactCompletionState;
  declared_by: ContactCompletionActorRole;
  declared_at: Date;
  confirmed_at: Date | null;
  contested_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type ContactCompletionEventRow = {
  id: string;
  completion_id: string;
  contact_id: string;
  actor_role: ContactCompletionActorRole;
  action: ContactCompletionAction;
  inbound_message_id: string;
  created_at: Date;
};

export interface ContactCompletionRepository {
  findContactByPublicCode(db: DatabaseClient, code: string): Promise<ContactRow | null>;
  lockContact(db: DatabaseClient, contactId: string): Promise<ContactRow | null>;
  findCompletionByContactId(db: DatabaseClient, contactId: string, forUpdate?: boolean): Promise<ContactCompletionRow | null>;
  createCompletion(
    db: DatabaseClient,
    input: {
      contactId: string;
      state: ContactCompletionState;
      declaredBy: ContactCompletionActorRole;
      declaredAt?: Date;
      confirmedAt?: Date | null;
      contestedAt?: Date | null;
    }
  ): Promise<ContactCompletionRow>;
  updateCompletionState(
    db: DatabaseClient,
    id: string,
    input: {
      state: ContactCompletionState;
      confirmedAt?: Date | null;
      contestedAt?: Date | null;
    }
  ): Promise<ContactCompletionRow>;
  createEvent(
    db: DatabaseClient,
    input: {
      completionId: string;
      contactId: string;
      actorRole: ContactCompletionActorRole;
      action: ContactCompletionAction;
      inboundMessageId: string;
    }
  ): Promise<ContactCompletionEventRow>;
  updateContactStatus(db: DatabaseClient, contactId: string, status: string): Promise<void>;
  insertOutboundReply(
    db: DatabaseClient,
    input: {
      inboundId: string;
      purpose: "customer_reply" | "professional_reply";
      provider: string;
      recipientPhoneE164: string;
      textContent: string;
      completionEventId?: string | null;
    }
  ): Promise<string>;
  insertOutboundNotification(
    db: DatabaseClient,
    input: {
      purpose: "customer_contact_update" | "professional_contact_notification";
      provider: string;
      recipientPhoneE164: string;
      textContent: string;
      businessKey: string;
      completionEventId?: string | null;
    }
  ): Promise<string>;
  markInboundProcessed(
    db: DatabaseClient,
    input: {
      inboundId: string;
      result: ContactCompletionMessage;
      responseOutboundId: string;
    }
  ): Promise<void>;
}

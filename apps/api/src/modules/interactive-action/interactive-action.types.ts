import type {
  InteractiveActionType,
  InteractiveActionTokenStatus,
} from "@contatocerto/shared";
import type { DatabaseClient } from "../../database/connection.js";

export type InteractiveActionTokenRecord = {
  id: string;
  publicToken: string;
  actionType: InteractiveActionType;
  contactId: string;
  completionId: string | null;
  intendedActorRole: "customer" | "professional";
  intendedPhoneE164: string;
  outboundMessageId: string;
  status: InteractiveActionTokenStatus;
  expiresAt: Date;
  consumedAt: Date | null;
  consumedInboundId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateInteractiveActionTokenInput = {
  publicToken: string;
  actionType: InteractiveActionType;
  contactId: string;
  completionId?: string | null;
  intendedActorRole: "customer" | "professional";
  intendedPhoneE164: string;
  outboundMessageId: string;
  expiresAt?: Date;
};

export interface InteractiveActionRepository {
  createTokens(
    db: DatabaseClient,
    tokens: CreateInteractiveActionTokenInput[]
  ): Promise<InteractiveActionTokenRecord[]>;
  findByPublicToken(
    db: DatabaseClient,
    publicToken: string,
    forUpdate?: boolean
  ): Promise<InteractiveActionTokenRecord | null>;
  markConsumed(
    db: DatabaseClient,
    id: string,
    inboundId: string
  ): Promise<boolean>;
  markExpired(db: DatabaseClient, id: string): Promise<boolean>;
}

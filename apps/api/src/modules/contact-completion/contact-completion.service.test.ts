import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ContactCompletionService } from "./contact-completion.service.js";
import type {
  ContactCompletionRepository,
  ContactRow,
  ContactCompletionRow,
  ContactCompletionEventRow,
} from "./contact-completion.types.js";
import type { ChannelInboundMessageRecord } from "../channel-inbox/channel-inbox.types.js";
import type { DatabaseClient } from "../../database/connection.js";

function createMockContact(overrides: Partial<ContactRow> = {}): ContactRow {
  return {
    id: randomUUID(),
    customer_id: randomUUID(),
    professional_id: randomUUID(),
    search_request_id: randomUUID(),
    selection_conversation_id: randomUUID(),
    public_code: "CC-23456789",
    status: "shared",
    bilateral_snapshot: {
      public_code: "CC-23456789",
      service_name: "Eletricista Residencial",
      city: "Cuiabá",
      state: "MT",
      neighborhood: "Centro",
      summary: "Instalar tomadas",
      professional_name: "João Silva",
      professional_phone_e164: "+5565999990001",
      customer_phone_e164: "+5565988880002",
      notice_version: "bilateral-v1",
      notice_outbound_id: randomUUID(),
      notice_sent_at: new Date().toISOString(),
      choice_inbound_id: randomUUID(),
      chosen_at: new Date().toISOString(),
      consented_at: new Date().toISOString(),
      consent_method: "selection_after_notice",
    },
    ...overrides,
  };
}

function createInboundRecord(overrides: Partial<ChannelInboundMessageRecord> = {}): ChannelInboundMessageRecord {
  return {
    id: randomUUID(),
    provider: "test-provider",
    providerMessageId: "msg-" + randomUUID(),
    phoneE164: "+5565988880002", // default customer phone
    countryCode: "BR",
    rawText: "concluido CC-23456789",
    limitValue: 3,
    status: "processing",
    processingToken: "tok-" + randomUUID(),
    processingStartedAt: new Date(),
    processedAt: null,
    failureReason: null,
    result: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    responseOutboundId: null,
    recoveryState: "none",
    recoveryAction: "none",
    quarantineReason: null,
    recoveryNextAttemptAt: null,
    recoveryAttemptCount: 0,
    recoveryStartedAt: null,
    contextualQueue: false,
    ...overrides,
  };
}

function createMockDb(): DatabaseClient {
  return {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT status, processing_token, result, response_outbound_id FROM channel_inbound_messages")) {
        return {
          rows: [
            {
              status: "processing",
              processing_token: params?.[0] ? undefined : undefined,
              result: null,
              response_outbound_id: null,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("channel_inbound_messages WHERE id = $1 AND processing_token = $2")) {
        return { rows: [{ id: params?.[0] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as DatabaseClient;
}

test("contact completion service ignores global commands and non-completion messages", async () => {
  const service = new ContactCompletionService();
  const globalRecord = createInboundRecord({ rawText: "cancelar" });
  assert.equal(await service.handle(globalRecord), null);

  const searchRecord = createInboundRecord({ rawText: "quero um eletricista" });
  assert.equal(await service.handle(searchRecord), null);
});

test("contact completion service returns unavailable for unknown public code", async () => {
  const mockRepo: ContactCompletionRepository = {
    findContactByPublicCode: async () => null,
    lockContact: async () => null,
    findCompletionByContactId: async () => null,
    createCompletion: async () => { throw new Error("not called"); },
    updateCompletionState: async () => { throw new Error("not called"); },
    createEvent: async () => { throw new Error("not called"); },
    updateContactStatus: async () => {},
    insertOutboundReply: async () => randomUUID(),
    insertOutboundNotification: async () => randomUUID(),
    markInboundProcessed: async () => {},
  };

  const service = new ContactCompletionService(
    mockRepo,
    async (fn) => {
      const db = createMockDb();
      db.query = async (sql) => {
        if (sql.includes("SELECT status, processing_token")) {
          return { rows: [{ status: "processing", processing_token: "tok-1", result: null, response_outbound_id: null }], rowCount: 1 };
        }
        if (sql.includes("channel_inbound_messages WHERE id")) {
          return { rows: [{ id: "msg-1" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      };
      return fn(db);
    }
  );

  const record = createInboundRecord({ processingToken: "tok-1", rawText: "concluido CC-23456789" });
  const result = await service.handle(record);

  assert.ok(result);
  assert.equal(result.duplicate, false);
  assert.match(result.reply_text, /Não identifiquei uma solicitação ativa/);
  assert.equal(result.result.action, "unavailable");
});

test("contact completion service rejects unauthorized phone for valid public code", async () => {
  const contact = createMockContact();
  const mockRepo: ContactCompletionRepository = {
    findContactByPublicCode: async () => contact,
    lockContact: async () => contact,
    findCompletionByContactId: async () => null,
    createCompletion: async () => { throw new Error("not called"); },
    updateCompletionState: async () => { throw new Error("not called"); },
    createEvent: async () => { throw new Error("not called"); },
    updateContactStatus: async () => {},
    insertOutboundReply: async () => randomUUID(),
    insertOutboundNotification: async () => randomUUID(),
    markInboundProcessed: async () => {},
  };

  const service = new ContactCompletionService(
    mockRepo,
    async (fn) => {
      const db = createMockDb();
      db.query = async (sql) => {
        if (sql.includes("SELECT status, processing_token")) {
          return { rows: [{ status: "processing", processing_token: "tok-1", result: null, response_outbound_id: null }], rowCount: 1 };
        }
        if (sql.includes("channel_inbound_messages WHERE id")) {
          return { rows: [{ id: "msg-1" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      };
      return fn(db);
    }
  );

  // Send from unknown phone +5511999999999
  const record = createInboundRecord({
    phoneE164: "+5511999999999",
    processingToken: "tok-1",
    rawText: "concluido CC-23456789",
  });
  const result = await service.handle(record);

  assert.ok(result);
  assert.equal(result.result.action, "unavailable");
  assert.match(result.reply_text, /Não identifiquei uma solicitação ativa/);
});

test("contact completion service rejects completion on requested or declined contacts", async () => {
  const requestedContact = createMockContact({ status: "requested" });
  let currentContact = requestedContact;

  const mockRepo: ContactCompletionRepository = {
    findContactByPublicCode: async () => currentContact,
    lockContact: async () => currentContact,
    findCompletionByContactId: async () => null,
    createCompletion: async () => { throw new Error("not called"); },
    updateCompletionState: async () => { throw new Error("not called"); },
    createEvent: async () => { throw new Error("not called"); },
    updateContactStatus: async () => {},
    insertOutboundReply: async () => randomUUID(),
    insertOutboundNotification: async () => randomUUID(),
    markInboundProcessed: async () => {},
  };

  const service = new ContactCompletionService(
    mockRepo,
    async (fn) => {
      const db = createMockDb();
      db.query = async (sql) => {
        if (sql.includes("SELECT status, processing_token")) {
          return { rows: [{ status: "processing", processing_token: "tok-1", result: null, response_outbound_id: null }], rowCount: 1 };
        }
        if (sql.includes("channel_inbound_messages WHERE id")) {
          return { rows: [{ id: "msg-1" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      };
      return fn(db);
    }
  );

  const recordRequested = createInboundRecord({ processingToken: "tok-1", rawText: "concluido CC-23456789" });
  const resultReq = await service.handle(recordRequested);
  assert.ok(resultReq);
  assert.match(resultReq.reply_text, /aguardando resposta/);

  currentContact = createMockContact({ status: "declined" });
  const recordDeclined = createInboundRecord({ processingToken: "tok-1", rawText: "concluido CC-23456789" });
  const resultDec = await service.handle(recordDeclined);
  assert.ok(resultDec);
  assert.match(resultDec.reply_text, /foi recusada/);
});

test("customer declaration creates pending completion and notifies professional", async () => {
  const contact = createMockContact({ status: "accepted" });
  let createdCompletion: ContactCompletionRow | null = null;
  let createdEvent: ContactCompletionEventRow | null = null;
  let outboundNotification: { purpose: string; recipientPhoneE164: string; textContent: string; businessKey: string } | null = null;
  let outboundReply: { purpose: string; recipientPhoneE164: string; textContent: string } | null = null;

  const mockRepo: ContactCompletionRepository = {
    findContactByPublicCode: async () => contact,
    lockContact: async () => contact,
    findCompletionByContactId: async () => createdCompletion,
    createCompletion: async (_db, input) => {
      createdCompletion = {
        id: randomUUID(),
        contact_id: input.contactId,
        state: input.state,
        declared_by: input.declaredBy,
        declared_at: new Date(),
        confirmed_at: null,
        contested_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      return createdCompletion;
    },
    updateCompletionState: async () => { throw new Error("not called"); },
    createEvent: async (_db, input) => {
      createdEvent = {
        id: randomUUID(),
        completion_id: input.completionId,
        contact_id: input.contactId,
        actor_role: input.actorRole,
        action: input.action,
        inbound_message_id: input.inboundMessageId,
        created_at: new Date(),
      };
      return createdEvent;
    },
    updateContactStatus: async () => { throw new Error("contact status should not change yet"); },
    insertOutboundReply: async (_db, input) => {
      outboundReply = input;
      return randomUUID();
    },
    insertOutboundNotification: async (_db, input) => {
      outboundNotification = input;
      return randomUUID();
    },
    markInboundProcessed: async () => {},
  };

  const service = new ContactCompletionService(
    mockRepo,
    async (fn) => {
      const db = createMockDb();
      db.query = async (sql) => {
        if (sql.includes("SELECT status, processing_token")) {
          return { rows: [{ status: "processing", processing_token: "tok-1", result: null, response_outbound_id: null }], rowCount: 1 };
        }
        if (sql.includes("channel_inbound_messages WHERE id")) {
          return { rows: [{ id: "msg-1" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      };
      return fn(db);
    }
  );

  const customerRecord = createInboundRecord({
    phoneE164: "+5565988880002",
    processingToken: "tok-1",
    rawText: "concluido CC-23456789",
  });
  const res = await service.handle(customerRecord);

  assert.ok(res);
  assert.equal(res.result.action, "declared");
  assert.equal(res.result.state, "pending_confirmation");
  assert.ok(createdCompletion);
  assert.equal(createdCompletion.declared_by, "customer");
  assert.equal(createdCompletion.state, "pending_confirmation");
  assert.ok(createdEvent);
  assert.equal(createdEvent.actor_role, "customer");
  assert.equal(createdEvent.action, "declared");

  // Counterpart notification sent to professional
  assert.ok(outboundNotification);
  assert.equal(outboundNotification.recipientPhoneE164, "+5565999990001");
  assert.equal(outboundNotification.purpose, "professional_contact_notification");
  assert.match(outboundNotification.textContent, /O cliente declarou a conclusão do serviço/);
  assert.equal(outboundNotification.businessKey, `contact:${contact.id}:completion:prompt`);

  // Sender reply to customer
  assert.ok(outboundReply);
  assert.equal(outboundReply.recipientPhoneE164, "+5565988880002");
  assert.equal(outboundReply.purpose, "customer_reply");
  assert.match(outboundReply.textContent, /Aguardando confirmação do profissional/);
});

test("professional confirmation completes contact and notifies customer", async () => {
  const contact = createMockContact({ status: "accepted" });
  let completion: ContactCompletionRow = {
    id: randomUUID(),
    contact_id: contact.id,
    state: "pending_confirmation",
    declared_by: "customer",
    declared_at: new Date(),
    confirmed_at: null,
    contested_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
  let contactStatus = "accepted";
  let createdEvent: ContactCompletionEventRow | null = null;
  let outboundNotification: { purpose: string; recipientPhoneE164: string; textContent: string; businessKey: string } | null = null;

  const mockRepo: ContactCompletionRepository = {
    findContactByPublicCode: async () => contact,
    lockContact: async () => ({ ...contact, status: contactStatus }),
    findCompletionByContactId: async () => completion,
    createCompletion: async () => { throw new Error("not called"); },
    updateCompletionState: async (_db, id, input) => {
      completion = {
        ...completion,
        state: input.state,
        confirmed_at: input.confirmedAt ?? null,
      };
      return completion;
    },
    createEvent: async (_db, input) => {
      createdEvent = {
        id: randomUUID(),
        completion_id: input.completionId,
        contact_id: input.contactId,
        actor_role: input.actorRole,
        action: input.action,
        inbound_message_id: input.inboundMessageId,
        created_at: new Date(),
      };
      return createdEvent;
    },
    updateContactStatus: async (_db, _id, status) => {
      contactStatus = status;
    },
    insertOutboundReply: async () => randomUUID(),
    insertOutboundNotification: async (_db, input) => {
      outboundNotification = input;
      return randomUUID();
    },
    markInboundProcessed: async () => {},
  };

  const service = new ContactCompletionService(
    mockRepo,
    async (fn) => {
      const db = createMockDb();
      db.query = async (sql) => {
        if (sql.includes("SELECT status, processing_token")) {
          return { rows: [{ status: "processing", processing_token: "tok-2", result: null, response_outbound_id: null }], rowCount: 1 };
        }
        if (sql.includes("channel_inbound_messages WHERE id")) {
          return { rows: [{ id: "msg-2" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      };
      return fn(db);
    }
  );

  const profRecord = createInboundRecord({
    phoneE164: "+5565999990001", // professional phone
    processingToken: "tok-2",
    rawText: "confirmar CC-23456789",
  });
  const res = await service.handle(profRecord);

  assert.ok(res);
  assert.equal(res.result.action, "confirmed");
  assert.equal(res.result.state, "confirmed");
  assert.equal(contactStatus, "completed");
  assert.equal(completion.state, "confirmed");
  assert.ok(createdEvent);
  assert.equal(createdEvent.actor_role, "professional");
  assert.equal(createdEvent.action, "confirmed");

  // Notification to customer
  assert.ok(outboundNotification);
  assert.equal(outboundNotification.recipientPhoneE164, "+5565988880002");
  assert.equal(outboundNotification.purpose, "customer_contact_update");
  assert.match(outboundNotification.textContent, /O profissional confirmou a conclusão/);
  assert.equal(outboundNotification.businessKey, `contact:${contact.id}:completion:confirmed`);
});

test("counterpart contestation preserves accepted status and notifies counterpart", async () => {
  const contact = createMockContact({ status: "accepted" });
  let completion: ContactCompletionRow = {
    id: randomUUID(),
    contact_id: contact.id,
    state: "pending_confirmation",
    declared_by: "customer",
    declared_at: new Date(),
    confirmed_at: null,
    contested_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
  const contactStatus = "accepted";
  let createdEvent: ContactCompletionEventRow | null = null;
  let outboundNotification: { purpose: string; recipientPhoneE164: string; textContent: string; businessKey: string } | null = null;

  const mockRepo: ContactCompletionRepository = {
    findContactByPublicCode: async () => contact,
    lockContact: async () => ({ ...contact, status: contactStatus }),
    findCompletionByContactId: async () => completion,
    createCompletion: async () => { throw new Error("not called"); },
    updateCompletionState: async (_db, id, input) => {
      completion = {
        ...completion,
        state: input.state,
        contested_at: input.contestedAt ?? null,
      };
      return completion;
    },
    createEvent: async (_db, input) => {
      createdEvent = {
        id: randomUUID(),
        completion_id: input.completionId,
        contact_id: input.contactId,
        actor_role: input.actorRole,
        action: input.action,
        inbound_message_id: input.inboundMessageId,
        created_at: new Date(),
      };
      return createdEvent;
    },
    updateContactStatus: async () => {
      throw new Error("Contact status must remain accepted on contestation!");
    },
    insertOutboundReply: async () => randomUUID(),
    insertOutboundNotification: async (_db, input) => {
      outboundNotification = input;
      return randomUUID();
    },
    markInboundProcessed: async () => {},
  };

  const service = new ContactCompletionService(
    mockRepo,
    async (fn) => {
      const db = createMockDb();
      db.query = async (sql) => {
        if (sql.includes("SELECT status, processing_token")) {
          return { rows: [{ status: "processing", processing_token: "tok-3", result: null, response_outbound_id: null }], rowCount: 1 };
        }
        if (sql.includes("channel_inbound_messages WHERE id")) {
          return { rows: [{ id: "msg-3" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      };
      return fn(db);
    }
  );

  const profRecord = createInboundRecord({
    phoneE164: "+5565999990001",
    processingToken: "tok-3",
    rawText: "contestar CC-23456789",
  });
  const res = await service.handle(profRecord);

  assert.ok(res);
  assert.equal(res.result.action, "contested");
  assert.equal(res.result.state, "contested");
  assert.equal(contactStatus, "accepted");
  assert.equal(completion.state, "contested");
  assert.ok(createdEvent);
  assert.equal(createdEvent.actor_role, "professional");
  assert.equal(createdEvent.action, "contested");

  assert.ok(outboundNotification);
  assert.equal(outboundNotification.recipientPhoneE164, "+5565988880002");
  assert.equal(outboundNotification.purpose, "customer_contact_update");
  assert.match(outboundNotification.textContent, /O profissional contestou a declaração/);
  assert.equal(outboundNotification.businessKey, `contact:${contact.id}:completion:contested`);
});

test("simultaneous declaration from counterpart acts as confirmation", async () => {
  const contact = createMockContact({ status: "accepted" });
  let completion: ContactCompletionRow = {
    id: randomUUID(),
    contact_id: contact.id,
    state: "pending_confirmation",
    declared_by: "customer",
    declared_at: new Date(),
    confirmed_at: null,
    contested_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
  let contactStatus = "accepted";

  const mockRepo: ContactCompletionRepository = {
    findContactByPublicCode: async () => contact,
    lockContact: async () => ({ ...contact, status: contactStatus }),
    findCompletionByContactId: async () => completion,
    createCompletion: async () => { throw new Error("not called"); },
    updateCompletionState: async (_db, id, input) => {
      completion = {
        ...completion,
        state: input.state,
        confirmed_at: input.confirmedAt ?? null,
      };
      return completion;
    },
    createEvent: async (_db, input) => ({
      id: randomUUID(),
      completion_id: input.completionId,
      contact_id: input.contactId,
      actor_role: input.actorRole,
      action: input.action,
      inbound_message_id: input.inboundMessageId,
      created_at: new Date(),
    }),
    updateContactStatus: async (_db, _id, status) => {
      contactStatus = status;
    },
    insertOutboundReply: async () => randomUUID(),
    insertOutboundNotification: async () => randomUUID(),
    markInboundProcessed: async () => {},
  };

  const service = new ContactCompletionService(
    mockRepo,
    async (fn) => {
      const db = createMockDb();
      db.query = async (sql) => {
        if (sql.includes("SELECT status, processing_token")) {
          return { rows: [{ status: "processing", processing_token: "tok-4", result: null, response_outbound_id: null }], rowCount: 1 };
        }
        if (sql.includes("channel_inbound_messages WHERE id")) {
          return { rows: [{ id: "msg-4" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      };
      return fn(db);
    }
  );

  // Professional also declares completion independently
  const profRecord = createInboundRecord({
    phoneE164: "+5565999990001",
    processingToken: "tok-4",
    rawText: "concluido CC-23456789",
  });
  const res = await service.handle(profRecord);

  assert.ok(res);
  assert.equal(res.result.action, "confirmed");
  assert.equal(contactStatus, "completed");
  assert.equal(completion.state, "confirmed");
});

test("same-side repeated declaration behaves idempotently without new events", async () => {
  const contact = createMockContact({ status: "accepted" });
  const completion: ContactCompletionRow = {
    id: randomUUID(),
    contact_id: contact.id,
    state: "pending_confirmation",
    declared_by: "customer",
    declared_at: new Date(),
    confirmed_at: null,
    contested_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockRepo: ContactCompletionRepository = {
    findContactByPublicCode: async () => contact,
    lockContact: async () => contact,
    findCompletionByContactId: async () => completion,
    createCompletion: async () => { throw new Error("not called"); },
    updateCompletionState: async () => { throw new Error("not called"); },
    createEvent: async () => { throw new Error("should not create event on replay"); },
    updateContactStatus: async () => { throw new Error("not called"); },
    insertOutboundReply: async () => randomUUID(),
    insertOutboundNotification: async () => { throw new Error("should not notify on same-side replay"); },
    markInboundProcessed: async () => {},
  };

  const service = new ContactCompletionService(
    mockRepo,
    async (fn) => {
      const db = createMockDb();
      db.query = async (sql) => {
        if (sql.includes("SELECT status, processing_token")) {
          return { rows: [{ status: "processing", processing_token: "tok-5", result: null, response_outbound_id: null }], rowCount: 1 };
        }
        if (sql.includes("channel_inbound_messages WHERE id")) {
          return { rows: [{ id: "msg-5" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      };
      return fn(db);
    }
  );

  const customerRecord = createInboundRecord({
    phoneE164: "+5565988880002",
    processingToken: "tok-5",
    rawText: "concluido CC-23456789",
  });
  const res = await service.handle(customerRecord);

  assert.ok(res);
  assert.equal(res.result.action, "idempotent_replay");
  assert.match(res.reply_text, /Você já registrou a declaração/);
});

test("declarer cannot confirm or contest their own declaration", async () => {
  const contact = createMockContact({ status: "accepted" });
  const completion: ContactCompletionRow = {
    id: randomUUID(),
    contact_id: contact.id,
    state: "pending_confirmation",
    declared_by: "customer",
    declared_at: new Date(),
    confirmed_at: null,
    contested_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockRepo: ContactCompletionRepository = {
    findContactByPublicCode: async () => contact,
    lockContact: async () => contact,
    findCompletionByContactId: async () => completion,
    createCompletion: async () => { throw new Error("not called"); },
    updateCompletionState: async () => { throw new Error("not called"); },
    createEvent: async () => { throw new Error("not called"); },
    updateContactStatus: async () => { throw new Error("not called"); },
    insertOutboundReply: async () => randomUUID(),
    insertOutboundNotification: async () => { throw new Error("not called"); },
    markInboundProcessed: async () => {},
  };

  const service = new ContactCompletionService(
    mockRepo,
    async (fn) => {
      const db = createMockDb();
      db.query = async (sql) => {
        if (sql.includes("SELECT status, processing_token")) {
          return { rows: [{ status: "processing", processing_token: "tok-6", result: null, response_outbound_id: null }], rowCount: 1 };
        }
        if (sql.includes("channel_inbound_messages WHERE id")) {
          return { rows: [{ id: "msg-6" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      };
      return fn(db);
    }
  );

  // Customer tries to confirm own declaration
  const confirmRecord = createInboundRecord({
    phoneE164: "+5565988880002",
    processingToken: "tok-6",
    rawText: "confirmar CC-23456789",
  });
  const confirmRes = await service.handle(confirmRecord);
  assert.ok(confirmRes);
  assert.equal(confirmRes.result.action, "clarification");
  assert.match(confirmRes.reply_text, /Você é quem declarou a conclusão/);

  // Customer tries to contest own declaration
  const contestRecord = createInboundRecord({
    phoneE164: "+5565988880002",
    processingToken: "tok-6",
    rawText: "contestar CC-23456789",
  });
  const contestRes = await service.handle(contestRecord);
  assert.ok(contestRes);
  assert.equal(contestRes.result.action, "clarification");
  assert.match(contestRes.reply_text, /Você registrou a declaração de conclusão/);
});

test("confirm or contest without pending declaration returns clarification", async () => {
  const contact = createMockContact({ status: "accepted" });

  const mockRepo: ContactCompletionRepository = {
    findContactByPublicCode: async () => contact,
    lockContact: async () => contact,
    findCompletionByContactId: async () => null,
    createCompletion: async () => { throw new Error("not called"); },
    updateCompletionState: async () => { throw new Error("not called"); },
    createEvent: async () => { throw new Error("not called"); },
    updateContactStatus: async () => { throw new Error("not called"); },
    insertOutboundReply: async () => randomUUID(),
    insertOutboundNotification: async () => { throw new Error("not called"); },
    markInboundProcessed: async () => {},
  };

  const service = new ContactCompletionService(
    mockRepo,
    async (fn) => {
      const db = createMockDb();
      db.query = async (sql) => {
        if (sql.includes("SELECT status, processing_token")) {
          return { rows: [{ status: "processing", processing_token: "tok-7", result: null, response_outbound_id: null }], rowCount: 1 };
        }
        if (sql.includes("channel_inbound_messages WHERE id")) {
          return { rows: [{ id: "msg-7" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      };
      return fn(db);
    }
  );

  const confirmRecord = createInboundRecord({
    phoneE164: "+5565999990001",
    processingToken: "tok-7",
    rawText: "confirmar CC-23456789",
  });
  const confirmRes = await service.handle(confirmRecord);
  assert.ok(confirmRes);
  assert.equal(confirmRes.result.action, "clarification");
  assert.match(confirmRes.reply_text, /Não há declaração de conclusão pendente/);

  const contestRecord = createInboundRecord({
    phoneE164: "+5565999990001",
    processingToken: "tok-7",
    rawText: "contestar CC-23456789",
  });
  const contestRes = await service.handle(contestRecord);
  assert.ok(contestRes);
  assert.equal(contestRes.result.action, "clarification");
  assert.match(contestRes.reply_text, /Não há declaração de conclusão pendente para contestar/);
});

test("handles already completed and already contested contacts safely", async () => {
  const completedContact = createMockContact({ status: "completed" });
  const mockRepo: ContactCompletionRepository = {
    findContactByPublicCode: async () => completedContact,
    lockContact: async () => completedContact,
    findCompletionByContactId: async () => null,
    createCompletion: async () => { throw new Error("not called"); },
    updateCompletionState: async () => { throw new Error("not called"); },
    createEvent: async () => { throw new Error("not called"); },
    updateContactStatus: async () => { throw new Error("not called"); },
    insertOutboundReply: async () => randomUUID(),
    insertOutboundNotification: async () => { throw new Error("not called"); },
    markInboundProcessed: async () => {},
  };

  const service = new ContactCompletionService(
    mockRepo,
    async (fn) => {
      const db = createMockDb();
      db.query = async (sql) => {
        if (sql.includes("SELECT status, processing_token")) {
          return { rows: [{ status: "processing", processing_token: "tok-8", result: null, response_outbound_id: null }], rowCount: 1 };
        }
        if (sql.includes("channel_inbound_messages WHERE id")) {
          return { rows: [{ id: "msg-8" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      };
      return fn(db);
    }
  );

  const record = createInboundRecord({
    phoneE164: "+5565988880002",
    processingToken: "tok-8",
    rawText: "concluido CC-23456789",
  });
  const res = await service.handle(record);
  assert.ok(res);
  assert.equal(res.result.action, "idempotent_replay");
  assert.match(res.reply_text, /já foi concluída anteriormente/);
});

test("replays processed inbound with duplicate flag and preserved reply", async () => {
  const outboundId = randomUUID();
  const inboundId = randomUUID();
  const mockRepo: ContactCompletionRepository = {
    findContactByPublicCode: async () => { throw new Error("not called"); },
    lockContact: async () => { throw new Error("not called"); },
    findCompletionByContactId: async () => { throw new Error("not called"); },
    createCompletion: async () => { throw new Error("not called"); },
    updateCompletionState: async () => { throw new Error("not called"); },
    createEvent: async () => { throw new Error("not called"); },
    updateContactStatus: async () => { throw new Error("not called"); },
    insertOutboundReply: async () => { throw new Error("not called"); },
    insertOutboundNotification: async () => { throw new Error("not called"); },
    markInboundProcessed: async () => { throw new Error("not called"); },
  };

  const service = new ContactCompletionService(
    mockRepo,
    async (fn) => {
      const db = createMockDb();
      db.query = async (sql) => {
        if (sql.includes("SELECT status, processing_token")) {
          return {
            rows: [
              {
                status: "processed",
                processing_token: null,
                response_outbound_id: outboundId,
                result: {
                  route: "contact_completion",
                  action: "declared",
                  public_code: "CC-23456789",
                  reply_text: "Mensagem gravada",
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes("SELECT id, text_content, status FROM channel_outbound_messages")) {
          return {
            rows: [{ id: outboundId, text_content: "Mensagem gravada", status: "sent" }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      };
      return fn(db);
    }
  );

  const replayRecord = createInboundRecord({
    id: inboundId,
    rawText: "concluido CC-23456789",
  });
  const res = await service.handle(replayRecord);

  assert.ok(res);
  assert.equal(res.duplicate, true);
  assert.equal(res.reply_text, "Mensagem gravada");
  assert.equal(res.outbound.id, outboundId);
});

test("contact completion service is decoupled from active-search context fingerprint", async () => {
  const contact = createMockContact();
  const mockRepo: ContactCompletionRepository = {
    findContactByPublicCode: async () => contact,
    lockContact: async () => contact,
    findCompletionByContactId: async () => null,
    createCompletion: async () => ({
      id: randomUUID(),
      contact_id: contact.id,
      state: "pending_confirmation",
      declared_by: "customer",
      declared_at: new Date(),
      confirmed_at: null,
      contested_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    }),
    updateCompletionState: async () => { throw new Error("not called"); },
    createEvent: async () => ({
      id: randomUUID(),
      completion_id: randomUUID(),
      contact_id: contact.id,
      actor_role: "customer",
      action: "declared",
      inbound_message_id: randomUUID(),
      created_at: new Date(),
    }),
    updateContactStatus: async () => {},
    insertOutboundReply: async () => randomUUID(),
    insertOutboundNotification: async () => randomUUID(),
    markInboundProcessed: async () => {},
  };

  const service = new ContactCompletionService(
    mockRepo,
    async (fn) => {
      const db = createMockDb();
      db.query = async (sql) => {
        if (sql.includes("SELECT status, processing_token")) {
          return {
            rows: [{ status: "processing", processing_token: "tok-ctx", result: null, response_outbound_id: null }],
            rowCount: 1,
          };
        }
        if (sql.includes("channel_inbound_messages WHERE id")) {
          return { rows: [{ id: "msg-ctx" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      };
      return fn(db);
    }
  );

  // Inbound record has an active-search context fingerprint
  const record = createInboundRecord({
    rawText: `concluido ${contact.public_code}`,
    phoneE164: "+5565988880002",
    processingToken: "tok-ctx",
    contextFingerprint: "unrelated-active-search-fingerprint-12345",
  });

  const res = await service.handle(record);
  assert.ok(res);
  assert.equal(res.duplicate, false);
  assert.equal(res.result.action, "declared");
  assert.match(res.reply_text, /Aguardando confirmação do profissional/);
});

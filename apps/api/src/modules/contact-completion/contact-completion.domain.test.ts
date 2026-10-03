import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  executeCompletionDeclaration,
  executeCompletionConfirmation,
  executeCompletionContestation,
} from "./contact-completion.domain.js";
import type {
  ContactCompletionRepository,
  ContactRow,
  ContactCompletionRow,
  ContactCompletionEventRow,
} from "./contact-completion.types.js";
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

const mockDb = {} as DatabaseClient;

test("executeCompletionDeclaration creates completion aggregate, event, and prompts counterpart", async () => {
  const contact = createMockContact();
  const inboundId = randomUUID();
  let createdCompletion: ContactCompletionRow | null = null;
  let createdEvent: ContactCompletionEventRow | null = null;
  let outboundNotification: Record<string, unknown> | null = null;

  const mockRepo: ContactCompletionRepository = {
    findEligibleContactsByPhone: async () => [],
    findPendingCompletionsByPhone: async () => [],
    findLastClarification: async () => null,
    findContactByPublicCode: async () => null,
    lockContact: async () => contact,
    findCompletionByContactId: async () => null,
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
    updateContactStatus: async () => {},
    insertOutboundReply: async () => randomUUID(),
    insertOutboundNotification: async (_db, input) => {
      outboundNotification = input;
      return randomUUID();
    },
    markInboundProcessed: async () => {},
  };

  const outcome = await executeCompletionDeclaration(mockDb, contact, "customer", inboundId, {
    repository: mockRepo,
    provider: "test-provider",
  });

  assert.equal(outcome.action, "declared");
  assert.match(outcome.replyText, /Solicitação de conclusão registrada/);
  assert.equal(createdCompletion?.state, "pending_confirmation");
  assert.equal(createdCompletion?.declared_by, "customer");
  assert.equal(createdEvent?.action, "declared");
  assert.equal(outboundNotification?.purpose, "professional_contact_notification");
  assert.equal(outboundNotification?.businessKey, `contact:${contact.id}:completion:prompt`);
});

test("executeCompletionDeclaration same-side replay returns idempotent_replay without creating duplicate records", async () => {
  const contact = createMockContact();
  const inboundId = randomUUID();
  const existingCompletion: ContactCompletionRow = {
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

  let eventCreated = false;
  const mockRepo: ContactCompletionRepository = {
    findEligibleContactsByPhone: async () => [],
    findPendingCompletionsByPhone: async () => [],
    findLastClarification: async () => null,
    findContactByPublicCode: async () => null,
    lockContact: async () => contact,
    findCompletionByContactId: async () => existingCompletion,
    createCompletion: async () => { throw new Error("not called"); },
    updateCompletionState: async () => { throw new Error("not called"); },
    createEvent: async () => { eventCreated = true; throw new Error("not called"); },
    updateContactStatus: async () => {},
    insertOutboundReply: async () => randomUUID(),
    insertOutboundNotification: async () => randomUUID(),
    markInboundProcessed: async () => {},
  };

  const outcome = await executeCompletionDeclaration(mockDb, contact, "customer", inboundId, {
    repository: mockRepo,
  });

  assert.equal(outcome.action, "idempotent_replay");
  assert.match(outcome.replyText, /Você já registrou a declaração de conclusão/);
  assert.equal(eventCreated, false);
});

test("executeCompletionDeclaration counterpart declaration acts as confirmation", async () => {
  const contact = createMockContact();
  const inboundId = randomUUID();
  const existingCompletion: ContactCompletionRow = {
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

  let updatedStatus: string | null = null;
  let updatedCompletionState: string | null = null;
  let eventAction: string | null = null;

  const mockRepo: ContactCompletionRepository = {
    findEligibleContactsByPhone: async () => [],
    findPendingCompletionsByPhone: async () => [],
    findLastClarification: async () => null,
    findContactByPublicCode: async () => null,
    lockContact: async () => contact,
    findCompletionByContactId: async () => existingCompletion,
    createCompletion: async () => { throw new Error("not called"); },
    updateCompletionState: async (_db, id, input) => {
      updatedCompletionState = input.state;
      return { ...existingCompletion, state: input.state, confirmed_at: new Date() };
    },
    createEvent: async (_db, input) => {
      eventAction = input.action;
      return {
        id: randomUUID(),
        completion_id: input.completionId,
        contact_id: input.contactId,
        actor_role: input.actorRole,
        action: input.action,
        inbound_message_id: input.inboundMessageId,
        created_at: new Date(),
      };
    },
    updateContactStatus: async (_db, _id, status) => {
      updatedStatus = status;
    },
    insertOutboundReply: async () => randomUUID(),
    insertOutboundNotification: async () => randomUUID(),
    markInboundProcessed: async () => {},
  };

  const outcome = await executeCompletionDeclaration(mockDb, contact, "professional", inboundId, {
    repository: mockRepo,
  });

  assert.equal(outcome.action, "confirmed");
  assert.match(outcome.replyText, /confirmada com sucesso/);
  assert.equal(updatedCompletionState, "confirmed");
  assert.equal(updatedStatus, "completed");
  assert.equal(eventAction, "confirmed");
});

test("executeCompletionConfirmation validates counterpart confirmation and transitions contact to completed", async () => {
  const contact = createMockContact();
  const inboundId = randomUUID();
  const existingCompletion: ContactCompletionRow = {
    id: randomUUID(),
    contact_id: contact.id,
    state: "pending_confirmation",
    declared_by: "professional",
    declared_at: new Date(),
    confirmed_at: null,
    contested_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  let contactStatusUpdated: string | null = null;
  let notificationSent: Record<string, unknown> | null = null;

  const mockRepo: ContactCompletionRepository = {
    findEligibleContactsByPhone: async () => [],
    findPendingCompletionsByPhone: async () => [],
    findLastClarification: async () => null,
    findContactByPublicCode: async () => null,
    lockContact: async () => contact,
    findCompletionByContactId: async () => existingCompletion,
    createCompletion: async () => { throw new Error("not called"); },
    updateCompletionState: async (_db, _id, input) => ({
      ...existingCompletion,
      state: input.state,
      confirmed_at: new Date(),
    }),
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
      contactStatusUpdated = status;
    },
    insertOutboundReply: async () => randomUUID(),
    insertOutboundNotification: async (_db, input) => {
      notificationSent = input;
      return randomUUID();
    },
    markInboundProcessed: async () => {},
  };

  const outcome = await executeCompletionConfirmation(mockDb, contact, "customer", inboundId, {
    repository: mockRepo,
  });

  assert.equal(outcome.action, "confirmed");
  assert.match(outcome.replyText, /confirmada com sucesso/);
  assert.equal(contactStatusUpdated, "completed");
  assert.equal(notificationSent?.purpose, "professional_contact_notification");
  assert.equal(notificationSent?.businessKey, `contact:${contact.id}:completion:confirmed`);
});

test("executeCompletionConfirmation returns clarification if same-side attempts to confirm", async () => {
  const contact = createMockContact();
  const inboundId = randomUUID();
  const existingCompletion: ContactCompletionRow = {
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
    findEligibleContactsByPhone: async () => [],
    findPendingCompletionsByPhone: async () => [],
    findLastClarification: async () => null,
    findContactByPublicCode: async () => null,
    lockContact: async () => contact,
    findCompletionByContactId: async () => existingCompletion,
    createCompletion: async () => { throw new Error("not called"); },
    updateCompletionState: async () => { throw new Error("not called"); },
    createEvent: async () => { throw new Error("not called"); },
    updateContactStatus: async () => {},
    insertOutboundReply: async () => randomUUID(),
    insertOutboundNotification: async () => randomUUID(),
    markInboundProcessed: async () => {},
  };

  const outcome = await executeCompletionConfirmation(mockDb, contact, "customer", inboundId, {
    repository: mockRepo,
  });

  assert.equal(outcome.action, "clarification");
  assert.match(outcome.replyText, /Você é quem declarou a conclusão/);
});

test("executeCompletionContestation transitions completion to contested without completing contact", async () => {
  const contact = createMockContact();
  const inboundId = randomUUID();
  const existingCompletion: ContactCompletionRow = {
    id: randomUUID(),
    contact_id: contact.id,
    state: "pending_confirmation",
    declared_by: "professional",
    declared_at: new Date(),
    confirmed_at: null,
    contested_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  let contactStatusChanged = false;
  let completionState: string | null = null;
  let eventAction: string | null = null;
  let notificationSent: Record<string, unknown> | null = null;

  const mockRepo: ContactCompletionRepository = {
    findEligibleContactsByPhone: async () => [],
    findPendingCompletionsByPhone: async () => [],
    findLastClarification: async () => null,
    findContactByPublicCode: async () => null,
    lockContact: async () => contact,
    findCompletionByContactId: async () => existingCompletion,
    createCompletion: async () => { throw new Error("not called"); },
    updateCompletionState: async (_db, _id, input) => {
      completionState = input.state;
      return { ...existingCompletion, state: input.state, contested_at: new Date() };
    },
    createEvent: async (_db, input) => {
      eventAction = input.action;
      return {
        id: randomUUID(),
        completion_id: input.completionId,
        contact_id: input.contactId,
        actor_role: input.actorRole,
        action: input.action,
        inbound_message_id: input.inboundMessageId,
        created_at: new Date(),
      };
    },
    updateContactStatus: async () => {
      contactStatusChanged = true;
    },
    insertOutboundReply: async () => randomUUID(),
    insertOutboundNotification: async (_db, input) => {
      notificationSent = input;
      return randomUUID();
    },
    markInboundProcessed: async () => {},
  };

  const outcome = await executeCompletionContestation(mockDb, contact, "customer", inboundId, {
    repository: mockRepo,
  });

  assert.equal(outcome.action, "contested");
  assert.match(outcome.replyText, /A contestação da conclusão do serviço.*foi registrada/);
  assert.equal(completionState, "contested");
  assert.equal(contactStatusChanged, false, "Contact status must not change to completed on contestation");
  assert.equal(eventAction, "contested");
  assert.equal(notificationSent?.purpose, "professional_contact_notification");
  assert.equal(notificationSent?.businessKey, `contact:${contact.id}:completion:contested`);
});

test("contact status validations: completed contact is immutable to new declarations/contestations", async () => {
  const completedContact = createMockContact({ status: "completed" });
  const mockRepo = {} as ContactCompletionRepository;

  const decl = await executeCompletionDeclaration(mockDb, completedContact, "customer", randomUUID(), { repository: mockRepo });
  assert.equal(decl.action, "idempotent_replay");

  const conf = await executeCompletionConfirmation(mockDb, completedContact, "customer", randomUUID(), { repository: mockRepo });
  assert.equal(conf.action, "idempotent_replay");

  const cont = await executeCompletionContestation(mockDb, completedContact, "customer", randomUUID(), { repository: mockRepo });
  assert.equal(cont.action, "idempotent_replay");
  assert.match(cont.replyText, /não pode ser contestada/);
});

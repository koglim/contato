import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  executeUnavailabilityDeclaration,
  type UnavailabilityContactInput,
} from "./professional-unavailability.domain.js";
import type { DatabaseClient } from "../../database/connection.js";

function createMockContact(overrides: Partial<UnavailabilityContactInput> = {}): UnavailabilityContactInput {
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
      service_name: "Encanador",
      city: "Sinop",
      state: "MT",
      neighborhood: "Jardim Botânico",
      summary: "Trocar encanamento",
      professional_name: "Carlos Pedrosa",
      professional_phone_e164: "+5566999991111",
      customer_phone_e164: "+5566988882222",
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

test("executeUnavailabilityDeclaration records unavailability event, reopens search, and notifies customer", async () => {
  const contact = createMockContact();
  const inboundId = randomUUID();
  const eventId = randomUUID();
  const queries: { sql: string; values?: unknown[] }[] = [];

  const mockDb = {
    query: async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      if (sql.includes("SELECT id FROM professional_unavailability_events WHERE contact_id = $1")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO professional_unavailability_events")) {
        return { rows: [{ id: eventId }], rowCount: 1 };
      }
      if (sql.includes("UPDATE search_requests SET status = 'matched'")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("FROM search_conversations WHERE id = $1")) {
        return {
          rows: [
            {
              id: contact.selection_conversation_id,
              customer_id: contact.customer_id,
              status: "completed",
              service_text: "Encanador",
              valid: true,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM search_conversations\n         WHERE customer_id = $1 AND id <> $2 AND status = 'active'")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("UPDATE search_conversations SET resume_slot = 'selection'")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("UPDATE search_conversations SET status = 'active'")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("FROM matches WHERE search_request_id = $1")) {
        return { rows: [{ shown: 1, unshown: 0 }], rowCount: 1 };
      }
      if (sql.includes("SELECT provider FROM channel_inbound_messages")) {
        return { rows: [{ provider: "test-provider" }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO channel_outbound_messages")) {
        return { rows: [{ id: randomUUID() }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as DatabaseClient;

  const outcome = await executeUnavailabilityDeclaration(
    mockDb,
    contact,
    contact.professional_id,
    inboundId
  );

  assert.equal(outcome.action, "unavailability_declared");
  assert.equal(outcome.publicCode, "CC-23456789");
  assert.equal(outcome.eventId, eventId);
  assert.match(outcome.replyText, /Indisponibilidade registrada para CC-23456789\. O cliente foi avisado\./);

  const outboundQuery = queries.find((q) => q.sql.includes("INSERT INTO channel_outbound_messages"));
  assert.ok(outboundQuery);
  assert.match(outboundQuery.sql, /'customer_contact_update'/);
  assert.equal(outboundQuery.values?.[0], "test-provider");
  assert.match(String(outboundQuery.values?.[2]), /O profissional informou que não poderá atender/);
  assert.match(String(outboundQuery.values?.[2]), /Você pode escolher outra opção já apresentada/);
});

test("executeUnavailabilityDeclaration on already completed contact returns unavailable without mutating search", async () => {
  const contact = createMockContact({ status: "completed" });
  const queries: { sql: string; values?: unknown[] }[] = [];

  const mockDb = {
    query: async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      return { rows: [], rowCount: 0 };
    },
  } as unknown as DatabaseClient;

  const outcome = await executeUnavailabilityDeclaration(
    mockDb,
    contact,
    contact.professional_id,
    randomUUID()
  );

  assert.equal(outcome.action, "unavailable");
  assert.match(outcome.replyText, /já foi concluída/);
  assert.equal(queries.length, 0);
});

test("executeUnavailabilityDeclaration replay on already declared event returns cached response", async () => {
  const contact = createMockContact();
  const existingEventId = randomUUID();
  const existingOutboundId = randomUUID();

  const mockDb = {
    query: async (sql: string) => {
      if (sql.includes("SELECT id FROM professional_unavailability_events WHERE contact_id = $1")) {
        return { rows: [{ id: existingEventId }], rowCount: 1 };
      }
      if (sql.includes("SELECT outbound.id, outbound.text_content FROM channel_outbound_messages")) {
        return {
          rows: [{ id: existingOutboundId, text_content: "Mensagem prévia de indisponibilidade" }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as DatabaseClient;

  const outcome = await executeUnavailabilityDeclaration(
    mockDb,
    contact,
    contact.professional_id,
    randomUUID()
  );

  assert.equal(outcome.action, "unavailability_declared");
  assert.equal(outcome.replyText, "Mensagem prévia de indisponibilidade");
  assert.equal(outcome.eventId, existingEventId);
  assert.equal(outcome.responseOutboundId, existingOutboundId);
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { closeDatabaseConnection, query } from "../src/database/connection.js";

const internalApiKey = "integration-internal-key";

type Fixture = {
  customerId: string;
  conversationId: string;
  searchRequestId: string;
  phone: string;
  originalMatchIds: [string, string];
  nextMatchIds: [string, string];
  originalShownAt: [Date, Date];
  cleanup: () => Promise<void>;
};

async function createFixture(): Promise<Fixture> {
  const customerId = randomUUID();
  const categoryId = randomUUID();
  const serviceId = randomUUID();
  const searchRequestId = randomUUID();
  const conversationId = randomUUID();
  const phone = "+556699" + Math.floor(1000000 + Math.random() * 8999999).toString();
  const professionalIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const matchIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const professionalServiceIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

  await query(`INSERT INTO customers (id, phone_e164) VALUES ($1, $2)`, [customerId, phone]);
  await query(`INSERT INTO service_categories (id, name, slug) VALUES ($1, $2, $3)`, [categoryId, "Teste", `teste-${categoryId}`]);
  await query(`INSERT INTO services (id, category_id, name, slug) VALUES ($1, $2, $3, $4)`, [serviceId, categoryId, "Eletricista", `eletricista-${serviceId}`]);
  await query(
    `INSERT INTO professionals (id, display_name, slug, phone_e164)
     SELECT value::uuid, 'Profissional ' || row_number() OVER (), 'profissional-' || value, '+5566' || lpad(row_number() OVER ()::text, 9, '0')
       FROM unnest($1::uuid[]) AS input_ids(value)`,
    [professionalIds as unknown as string],
  );
  await query(
    `INSERT INTO professional_services (id, professional_id, service_id, price_mode, price_from_cents)
     SELECT ids.id, professionals.id, $2, 'from', 10000 + (row_number() OVER () * 1000)
       FROM unnest($1::uuid[]) WITH ORDINALITY AS ids(id, position)
       JOIN unnest($3::uuid[]) WITH ORDINALITY AS professionals(id, position)
         ON professionals.position = ids.position`,
    [professionalServiceIds as unknown as string, serviceId, professionalIds as unknown as string],
  );
  await query(
    `INSERT INTO search_requests (id, customer_id, raw_text, service_id, status)
     VALUES ($1, $2, 'preciso de eletricista', $3, 'matched')`,
    [searchRequestId, customerId, serviceId],
  );
  await query(
    `INSERT INTO search_conversations (
       id, customer_id, status, pending_slot, original_raw_text, service_text,
       country_code, limit_value, search_request_id, expires_at
     ) VALUES ($1, $2, 'active', 'selection', 'preciso de eletricista', 'eletricista', 'BR', 2, $3, NOW() + INTERVAL '1 hour')`,
    [conversationId, customerId, searchRequestId],
  );
  await query(
    `INSERT INTO matches (id, search_request_id, professional_id, rank_position, shown_at)
     VALUES ($1, $2, $3, 1, NOW()), ($4, $2, $5, 2, NOW()),
            ($6, $2, $7, 3, NULL), ($8, $2, $9, 4, NULL)`,
    [matchIds[0], searchRequestId, professionalIds[0], matchIds[1], professionalIds[1], matchIds[2], professionalIds[2], matchIds[3], professionalIds[3]],
  );
  const matches = await query<{ id: string; shown_at: Date }>(
    `SELECT id, shown_at
       FROM matches
      WHERE id = ANY($1::uuid[])
      ORDER BY rank_position`,
    [matchIds as unknown as string],
  );

  return {
    customerId,
    conversationId,
    searchRequestId,
    phone,
    originalMatchIds: [matchIds[0]!, matchIds[1]!],
    nextMatchIds: [matchIds[2]!, matchIds[3]!],
    originalShownAt: [matches.rows[0]!.shown_at, matches.rows[1]!.shown_at],
    cleanup: async () => {
      await query(`DELETE FROM channel_inbound_messages WHERE phone_e164 = $1`, [phone]);
      await query(`DELETE FROM matches WHERE search_request_id = $1`, [searchRequestId]);
      await query(`DELETE FROM search_conversations WHERE id = $1`, [conversationId]);
      await query(`DELETE FROM search_requests WHERE id = $1`, [searchRequestId]);
      await query(`DELETE FROM professional_services WHERE professional_id = ANY($1::uuid[])`, [professionalIds as unknown as string]);
      await query(`DELETE FROM professionals WHERE id = ANY($1::uuid[])`, [professionalIds as unknown as string]);
      await query(`DELETE FROM services WHERE id = $1`, [serviceId]);
      await query(`DELETE FROM service_categories WHERE id = $1`, [categoryId]);
      await query(`DELETE FROM customers WHERE id = $1`, [customerId]);
    },
  };
}

after(async () => closeDatabaseConnection());

test("Channel Inbox serializes concurrent show-more pages without duplicate professionals", { concurrency: false }, async () => {
  const fixture = await createFixture();
  const app = await buildApp({ internalApiKey });
  const payload = (providerMessageId: string) => ({
    provider: "test",
    provider_message_id: providerMessageId,
    phone_e164: fixture.phone,
    raw_text: "mostrar mais",
    country_code: "BR",
    limit: 2,
  });

  try {
    const [first, second] = await Promise.all([
      app.inject({ method: "POST", url: "/internal/channel/inbound/messages", headers: { "x-internal-key": internalApiKey }, payload: payload(randomUUID()) }),
      app.inject({ method: "POST", url: "/internal/channel/inbound/messages", headers: { "x-internal-key": internalApiKey }, payload: payload(randomUUID()) }),
    ]);
    const responses = [first, second];
    assert.equal(responses.filter((response) => response.statusCode === 200).length, 1);
    assert.equal(responses.filter((response) => response.statusCode === 409 && response.json().error === "selection_show_more_pending").length, 1);

    const outbound = await query<{ id: string; text_content: string; channel_inbound_message_id: string }>(
      `SELECT id, text_content, channel_inbound_message_id
         FROM channel_outbound_messages
        WHERE recipient_phone_e164 = $1`,
      [fixture.phone],
    );
    assert.equal(outbound.rows.length, 1);
    assert.match(outbound.rows[0]!.text_content, /3\./u);
    assert.match(outbound.rows[0]!.text_content, /4\./u);

    const associations = await query<{ match_id: string; count: number | string }>(
      `SELECT match_id, COUNT(*) AS count
         FROM channel_outbound_message_matches
        WHERE channel_outbound_message_id = $1
        GROUP BY match_id
        ORDER BY match_id`,
      [outbound.rows[0]!.id],
    );
    assert.deepEqual(associations.rows.map((row) => row.match_id).sort(), [...fixture.nextMatchIds].sort());
    assert.ok(associations.rows.every((row) => Number(row.count) === 1));

    const inbound = await query<{ status: string; outbound_count: number | string }>(
      `SELECT status,
              (SELECT COUNT(*) FROM channel_outbound_messages outbound WHERE outbound.channel_inbound_message_id = inbound.id) AS outbound_count
         FROM channel_inbound_messages inbound
        WHERE phone_e164 = $1
        ORDER BY provider_message_id`,
      [fixture.phone],
    );
    assert.equal(inbound.rows.filter((row) => row.status === "processed").length, 1);
    assert.equal(inbound.rows.filter((row) => row.status === "failed").length, 1);
    assert.deepEqual(inbound.rows.map((row) => Number(row.outbound_count)).sort(), [0, 1]);

    const original = await query<{ id: string; shown_at: Date | null; reservation_count: number | string }>(
      `SELECT matches.id, matches.shown_at,
              (SELECT COUNT(*) FROM channel_outbound_message_matches reservations WHERE reservations.match_id = matches.id) AS reservation_count
         FROM matches
        WHERE matches.id = ANY($1::uuid[])
        ORDER BY matches.rank_position`,
      [fixture.originalMatchIds as unknown as string],
    );
    assert.deepEqual(original.rows.map((row) => row.id), fixture.originalMatchIds);
    assert.deepEqual(original.rows.map((row) => row.shown_at?.getTime()), fixture.originalShownAt.map((value) => value.getTime()));
    assert.ok(original.rows.every((row) => Number(row.reservation_count) === 0));
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});

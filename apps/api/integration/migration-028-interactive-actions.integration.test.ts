import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closeDatabaseConnection, query } from "../src/database/connection.js";
import { rollbackThrough } from "./rollback-helper.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

after(async () => {
  // Ensure the database is always left at the latest migration
  await migrateUp();
  await closeDatabaseConnection();
});

const phone = () => `+5566${Math.floor(100000000 + Math.random() * 899999999)}`;

async function migrateUp(count?: number) {
  const args = [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js",
    "up",
    ...(count ? [String(count)] : []),
    "-m",
    "database/migrations",
    "--database-url-var",
    "DATABASE_URL",
  ];
  return promisify(execFile)(process.execPath, args, {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    env: process.env,
  });
}

test("Scenario A & B: Real schema-027 -> schema-028 upgrade and historical compatibility", async () => {
  // 1. Roll back to schema 027
  await rollbackThrough("028_add_interactive_actions_foundation");

  // Check 027 is applied, 028 is not
  const is027Applied = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM pgmigrations WHERE name = '027_add_connection_lifecycle_v2'"
  )).rows[0].cnt;
  assert.equal(is027Applied, 1, "027_add_connection_lifecycle_v2 must exist in pgmigrations");

  const is028AppliedBefore = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM pgmigrations WHERE name = '028_add_interactive_actions_foundation'"
  )).rows[0].cnt;
  assert.equal(is028AppliedBefore, 0, "028_add_interactive_actions_foundation must NOT exist before upgrade");

  const oldConstraintBefore = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM pg_constraint WHERE conname = 'channel_outbound_messages_message_type_check'"
  )).rows[0].cnt;
  assert.equal(oldConstraintBefore, 1, "channel_outbound_messages_message_type_check must exist under 027");

  const newConstraintBefore = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM pg_constraint WHERE conname = 'channel_outbound_messages_message_type_payload_chk'"
  )).rows[0].cnt;
  assert.equal(newConstraintBefore, 0, "channel_outbound_messages_message_type_payload_chk must NOT exist under 027");

  // Insert a historical text outbound under 027
  const histCustPhone = phone();
  const histInboundId = randomUUID();
  const histOutboundId = randomUUID();

  try {
    await query(
      `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text)
       VALUES ($1::uuid, 'test', $1::text, $2, 'texto histórico')`,
      [histInboundId, histCustPhone]
    );

    await query(
      `INSERT INTO channel_outbound_messages (id, channel_inbound_message_id, provider, recipient_phone_e164, message_type, text_content, status)
       VALUES ($1, $2, 'test', $3, 'text', 'Mensagem de texto pré-028', 'pending')`,
      [histOutboundId, histInboundId, histCustPhone]
    );

    // 2. Run migration up 1 (to apply 028)
    await migrateUp(1);

    // 3. Assert post-028 schema state
    const is028AppliedAfter = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM pgmigrations WHERE name = '028_add_interactive_actions_foundation'"
    )).rows[0].cnt;
    assert.equal(is028AppliedAfter, 1, "028_add_interactive_actions_foundation must exist in pgmigrations");

    // Old constraint dropped, new constraint added
    const oldConstraintAfter = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM pg_constraint WHERE conname = 'channel_outbound_messages_message_type_check'"
    )).rows[0].cnt;
    assert.equal(oldConstraintAfter, 0, "channel_outbound_messages_message_type_check must be dropped in 028");

    const newConstraintAfter = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM pg_constraint WHERE conname = 'channel_outbound_messages_message_type_payload_chk'"
    )).rows[0].cnt;
    assert.equal(newConstraintAfter, 1, "channel_outbound_messages_message_type_payload_chk must exist in 028");

    // Table interactive_action_tokens exists
    const tableExists = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM information_schema.tables WHERE table_name = 'interactive_action_tokens'"
    )).rows[0].cnt;
    assert.equal(tableExists, 1, "interactive_action_tokens table must exist");

    // Columns exist
    const outboundCol = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM information_schema.columns WHERE table_name = 'channel_outbound_messages' AND column_name = 'interactive_payload'"
    )).rows[0].cnt;
    assert.equal(outboundCol, 1, "interactive_payload column must exist on channel_outbound_messages");

    const inboundCol = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM information_schema.columns WHERE table_name = 'channel_inbound_messages' AND column_name = 'interactive_action_id'"
    )).rows[0].cnt;
    assert.equal(inboundCol, 1, "interactive_action_id column must exist on channel_inbound_messages");

    // Indexes exist
    const tokenContactIdx = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM pg_indexes WHERE indexname = 'interactive_action_tokens_contact_idx'"
    )).rows[0].cnt;
    assert.equal(tokenContactIdx, 1, "interactive_action_tokens_contact_idx must exist");

    const tokenExpiryIdx = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM pg_indexes WHERE indexname = 'interactive_action_tokens_expiry_idx'"
    )).rows[0].cnt;
    assert.equal(tokenExpiryIdx, 1, "interactive_action_tokens_expiry_idx must exist");

    const inboundActionIdx = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM pg_indexes WHERE indexname = 'channel_inbound_messages_action_id_idx'"
    )).rows[0].cnt;
    assert.equal(inboundActionIdx, 1, "channel_inbound_messages_action_id_idx must exist");

    // Supporting unique constraint on contact_completions exists
    const completionUnique = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM pg_constraint WHERE conname = 'contact_completions_contact_id_id_key'"
    )).rows[0].cnt;
    assert.equal(completionUnique, 1, "contact_completions_contact_id_id_key constraint must exist");

    // Supporting public_token constraint on interactive_action_tokens exists
    const tokenCheck = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM pg_constraint WHERE conname = 'interactive_action_tokens_public_token_chk'"
    )).rows[0].cnt;
    assert.equal(tokenCheck, 1, "interactive_action_tokens_public_token_chk constraint must exist");

    // Historical row compatibility: unchanged message_type='text' and interactive_payload IS NULL
    const histRow = (await query<{ message_type: string; interactive_payload: unknown }>(
      "SELECT message_type, interactive_payload FROM channel_outbound_messages WHERE id = $1",
      [histOutboundId]
    )).rows[0];
    assert.equal(histRow.message_type, "text");
    assert.equal(histRow.interactive_payload, null);
  } finally {
    await query("DELETE FROM channel_outbound_messages WHERE id = $1", [histOutboundId]);
    await query("DELETE FROM channel_inbound_messages WHERE id = $1", [histInboundId]);
    await migrateUp();
  }
});

test("Scenario C, D, E, F, G: channel_outbound_messages message_type and interactive_payload constraints", async () => {
  await migrateUp();

  const customerPhone = phone();
  const inboundId = randomUUID();

  try {
    await query(
      `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text)
       VALUES ($1::uuid, 'test', $1::text, $2, 'teste payload')`,
      [inboundId, customerPhone]
    );

    // C. Valid text row: message_type='text' + NULL payload
    const textOutboundId = randomUUID();
    await query(
      `INSERT INTO channel_outbound_messages (id, channel_inbound_message_id, provider, recipient_phone_e164, message_type, text_content, interactive_payload, status)
       VALUES ($1, $2, 'test', $3, 'text', 'Texto válido', NULL, 'pending')`,
      [textOutboundId, inboundId, customerPhone]
    );
    const rowC = (await query<{ message_type: string; interactive_payload: unknown }>(
      "SELECT message_type, interactive_payload FROM channel_outbound_messages WHERE id = $1",
      [textOutboundId]
    )).rows[0];
    assert.equal(rowC.message_type, "text");
    assert.equal(rowC.interactive_payload, null);
    await query("DELETE FROM channel_outbound_messages WHERE id = $1", [textOutboundId]);

    // D. Invalid text row: message_type='text' + non-null interactive_payload -> rejected
    await assert.rejects(
      query(
        `INSERT INTO channel_outbound_messages (id, channel_inbound_message_id, provider, recipient_phone_e164, message_type, text_content, interactive_payload, status)
         VALUES ($1, $2, 'test', $3, 'text', 'Texto inválido', '{"actions":[]}'::jsonb, 'pending')`,
        [randomUUID(), inboundId, customerPhone]
      ),
      /check/i
    );

    // E. Valid interactive row: message_type='interactive' + JSONB payload
    const interactiveOutboundId = randomUUID();
    const payload = {
      schema_version: 1,
      type: "button_group",
      body: "Escolha uma opção",
      actions: [{ action_id: "ia_123", label: "Confirmar" }],
    };
    await query(
      `INSERT INTO channel_outbound_messages (id, channel_inbound_message_id, provider, recipient_phone_e164, message_type, text_content, interactive_payload, status)
       VALUES ($1, $2, 'test', $3, 'interactive', 'Fallback text', $4::jsonb, 'pending')`,
      [interactiveOutboundId, inboundId, customerPhone, JSON.stringify(payload)]
    );
    const rowE = (await query<{ message_type: string; interactive_payload: Record<string, unknown> }>(
      "SELECT message_type, interactive_payload FROM channel_outbound_messages WHERE id = $1",
      [interactiveOutboundId]
    )).rows[0];
    assert.equal(rowE.message_type, "interactive");
    assert.deepEqual(rowE.interactive_payload, payload);
    await query("DELETE FROM channel_outbound_messages WHERE id = $1", [interactiveOutboundId]);

    // F. Invalid interactive row: message_type='interactive' + NULL payload -> rejected
    await assert.rejects(
      query(
        `INSERT INTO channel_outbound_messages (id, channel_inbound_message_id, provider, recipient_phone_e164, message_type, text_content, interactive_payload, status)
         VALUES ($1, $2, 'test', $3, 'interactive', 'Fallback text', NULL, 'pending')`,
        [randomUUID(), inboundId, customerPhone]
      ),
      /check/i
    );

    // G. Unknown message_type rejected
    await assert.rejects(
      query(
        `INSERT INTO channel_outbound_messages (id, channel_inbound_message_id, provider, recipient_phone_e164, message_type, text_content, interactive_payload, status)
         VALUES ($1, $2, 'test', $3, 'image', 'Imagem', NULL, 'pending')`,
        [randomUUID(), inboundId, customerPhone]
      ),
      /check/i
    );
  } finally {
    await query("DELETE FROM channel_outbound_messages WHERE channel_inbound_message_id = $1", [inboundId]);
    await query("DELETE FROM channel_inbound_messages WHERE id = $1", [inboundId]);
  }
});

test("Scenario H through S: interactive_action_tokens table constraints and integrity", async () => {
  await migrateUp();

  const customerId = randomUUID();
  const professionalId = randomUUID();
  const searchId = randomUUID();
  const contactId = randomUUID();
  const contactIdB = randomUUID();
  const completionId = randomUUID();
  const customerPhone = phone();
  const professionalPhone = phone();
  const inboundId = randomUUID();
  const customerOutboundId = randomUUID();
  const profOutboundId = randomUUID();

  // Semantically opaque tokens for v1 actions
  const tokenConfirm = "ia_" + randomUUID().replaceAll("-", "");
  const tokenContest = "ia_" + randomUUID().replaceAll("-", "");
  const tokenDeclComp = "ia_" + randomUUID().replaceAll("-", "");
  const tokenDeclUnavail = "ia_" + randomUUID().replaceAll("-", "");

  try {
    // Setup fixtures
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [customerId, customerPhone]);
    await query("INSERT INTO professionals (id, display_name, slug, phone_e164, status) VALUES ($1::uuid, 'Prof 028', $1::text, $2, 'active')", [professionalId, professionalPhone]);
    await query("INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1, $2, 'eletricista', 'selected')", [searchId, customerId]);
    await query(
      `INSERT INTO contacts (id, search_request_id, customer_id, professional_id, status)
       VALUES ($1, $2, $3, $4, 'shared')`,
      [contactId, searchId, customerId, professionalId]
    );
    await query(
      `INSERT INTO contact_completions (id, contact_id, state, declared_by, declared_at)
       VALUES ($1, $2, 'pending_confirmation', 'professional', NOW())`,
      [completionId, contactId]
    );
    await query(
      `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text)
       VALUES ($1::uuid, 'test', $1::text, $2, 'origem outbound')`,
      [inboundId, customerPhone]
    );

    // Setup provider-neutral interactive outbounds for customer and professional
    const customerPayload = {
      schema_version: 1,
      type: "button_group",
      body: "O profissional declarou a conclusão do serviço. Por favor, confirme:",
      actions: [
        { action_id: tokenConfirm, label: "Confirmar" },
        { action_id: tokenContest, label: "Contestar" },
      ],
    };
    await query(
      `INSERT INTO channel_outbound_messages (
        id, channel_inbound_message_id, provider, recipient_phone_e164,
        message_type, text_content, interactive_payload, status
      ) VALUES ($1, $2, 'test', $3, 'interactive', 'Confirme a conclusão do serviço', $4::jsonb, 'pending')`,
      [customerOutboundId, inboundId, customerPhone, JSON.stringify(customerPayload)]
    );

    const profPayload = {
      schema_version: 1,
      type: "button_group",
      body: "Informações do atendimento. Escolha uma opção:",
      actions: [
        { action_id: tokenDeclComp, label: "Concluído" },
        { action_id: tokenDeclUnavail, label: "Não consigo atender" },
      ],
    };
    await query(
      `INSERT INTO channel_outbound_messages (
        id, channel_inbound_message_id, provider, recipient_phone_e164,
        message_type, text_content, interactive_payload, status
      ) VALUES ($1, $2, 'test', $3, 'interactive', 'Atualize o status do atendimento', $4::jsonb, 'pending')`,
      [profOutboundId, inboundId, professionalPhone, JSON.stringify(profPayload)]
    );

    // H. Valid tokens for each of the 4 action types bound to corresponding interactive outbounds
    // 1. confirm_completion (customer + completion_id)
    await query(
      `INSERT INTO interactive_action_tokens (
        public_token, action_type, contact_id, completion_id, intended_actor_role,
        intended_phone_e164, outbound_message_id, status, expires_at
      ) VALUES ($1, 'confirm_completion', $2, $3, 'customer', $4, $5, 'active', NOW() + INTERVAL '1 day')`,
      [tokenConfirm, contactId, completionId, customerPhone, customerOutboundId]
    );

    // 2. contest_completion (customer + completion_id)
    await query(
      `INSERT INTO interactive_action_tokens (
        public_token, action_type, contact_id, completion_id, intended_actor_role,
        intended_phone_e164, outbound_message_id, status, expires_at
      ) VALUES ($1, 'contest_completion', $2, $3, 'customer', $4, $5, 'active', NOW() + INTERVAL '1 day')`,
      [tokenContest, contactId, completionId, customerPhone, customerOutboundId]
    );

    // 3. declare_completion (professional + NULL completion_id)
    await query(
      `INSERT INTO interactive_action_tokens (
        public_token, action_type, contact_id, completion_id, intended_actor_role,
        intended_phone_e164, outbound_message_id, status, expires_at
      ) VALUES ($1, 'declare_completion', $2, NULL, 'professional', $3, $4, 'active', NOW() + INTERVAL '1 day')`,
      [tokenDeclComp, contactId, professionalPhone, profOutboundId]
    );

    // 4. declare_unavailability (professional + NULL completion_id)
    await query(
      `INSERT INTO interactive_action_tokens (
        public_token, action_type, contact_id, completion_id, intended_actor_role,
        intended_phone_e164, outbound_message_id, status, expires_at
      ) VALUES ($1, 'declare_unavailability', $2, NULL, 'professional', $3, $4, 'active', NOW() + INTERVAL '1 day')`,
      [tokenDeclUnavail, contactId, professionalPhone, profOutboundId]
    );

    const tokenCount = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM interactive_action_tokens WHERE contact_id = $1",
      [contactId]
    )).rows[0].cnt;
    assert.equal(tokenCount, 4);

    // I. Invalid action_type rejected
    await assert.rejects(
      query(
        `INSERT INTO interactive_action_tokens (
          public_token, action_type, contact_id, completion_id, intended_actor_role,
          intended_phone_e164, outbound_message_id, status, expires_at
        ) VALUES ($1, 'unknown_action', $2, NULL, 'customer', $3, $4, 'active', NOW() + INTERVAL '1 day')`,
        ["ia_" + randomUUID().replaceAll("-", ""), contactId, customerPhone, customerOutboundId]
      ),
      /check/i
    );

    // J. Customer confirm_completion without completion_id rejected
    await assert.rejects(
      query(
        `INSERT INTO interactive_action_tokens (
          public_token, action_type, contact_id, completion_id, intended_actor_role,
          intended_phone_e164, outbound_message_id, status, expires_at
        ) VALUES ($1, 'confirm_completion', $2, NULL, 'customer', $3, $4, 'active', NOW() + INTERVAL '1 day')`,
        ["ia_" + randomUUID().replaceAll("-", ""), contactId, customerPhone, customerOutboundId]
      ),
      /check/i
    );

    // K. Professional declare_completion with non-null completion_id rejected
    await assert.rejects(
      query(
        `INSERT INTO interactive_action_tokens (
          public_token, action_type, contact_id, completion_id, intended_actor_role,
          intended_phone_e164, outbound_message_id, status, expires_at
        ) VALUES ($1, 'declare_completion', $2, $3, 'professional', $4, $5, 'active', NOW() + INTERVAL '1 day')`,
        ["ia_" + randomUUID().replaceAll("-", ""), contactId, completionId, professionalPhone, profOutboundId]
      ),
      /check/i
    );

    // L. Professional declare_unavailability with non-null completion_id rejected
    await assert.rejects(
      query(
        `INSERT INTO interactive_action_tokens (
          public_token, action_type, contact_id, completion_id, intended_actor_role,
          intended_phone_e164, outbound_message_id, status, expires_at
        ) VALUES ($1, 'declare_unavailability', $2, $3, 'professional', $4, $5, 'active', NOW() + INTERVAL '1 day')`,
        ["ia_" + randomUUID().replaceAll("-", ""), contactId, completionId, professionalPhone, profOutboundId]
      ),
      /check/i
    );

    // M. Consumed status without consumed_at/consumed_inbound_id rejected
    await assert.rejects(
      query(
        `INSERT INTO interactive_action_tokens (
          public_token, action_type, contact_id, completion_id, intended_actor_role,
          intended_phone_e164, outbound_message_id, status, expires_at, consumed_at, consumed_inbound_id
        ) VALUES ($1, 'declare_completion', $2, NULL, 'professional', $3, $4, 'consumed', NOW() + INTERVAL '1 day', NULL, NULL)`,
        ["ia_" + randomUUID().replaceAll("-", ""), contactId, professionalPhone, profOutboundId]
      ),
      /check/i
    );

    // N. Non-consumed status with consumed metadata populated rejected
    await assert.rejects(
      query(
        `INSERT INTO interactive_action_tokens (
          public_token, action_type, contact_id, completion_id, intended_actor_role,
          intended_phone_e164, outbound_message_id, status, expires_at, consumed_at, consumed_inbound_id
        ) VALUES ($1, 'declare_completion', $2, NULL, 'professional', $3, $4, 'active', NOW() + INTERVAL '1 day', NOW(), $5)`,
        ["ia_" + randomUUID().replaceAll("-", ""), contactId, professionalPhone, profOutboundId, inboundId]
      ),
      /check/i
    );

    // O. Invalid phone format rejected
    await assert.rejects(
      query(
        `INSERT INTO interactive_action_tokens (
          public_token, action_type, contact_id, completion_id, intended_actor_role,
          intended_phone_e164, outbound_message_id, status, expires_at
        ) VALUES ($1, 'declare_completion', $2, NULL, 'professional', 'invalid-phone', $3, 'active', NOW() + INTERVAL '1 day')`,
        ["ia_" + randomUUID().replaceAll("-", ""), contactId, profOutboundId]
      ),
      /check/i
    );

    // Public token constraint tests (Blocker 4)
    // Empty public_token rejected
    await assert.rejects(
      query(
        `INSERT INTO interactive_action_tokens (
          public_token, action_type, contact_id, completion_id, intended_actor_role,
          intended_phone_e164, outbound_message_id, status, expires_at
        ) VALUES ('', 'declare_completion', $1, NULL, 'professional', $2, $3, 'active', NOW() + INTERVAL '1 day')`,
        [contactId, professionalPhone, profOutboundId]
      ),
      /check/i
    );

    // Whitespace public_token rejected (space inside, leading space, trailing newline)
    await assert.rejects(
      query(
        `INSERT INTO interactive_action_tokens (
          public_token, action_type, contact_id, completion_id, intended_actor_role,
          intended_phone_e164, outbound_message_id, status, expires_at
        ) VALUES ($1, 'declare_completion', $2, NULL, 'professional', $3, $4, 'active', NOW() + INTERVAL '1 day')`,
        ["ia token space", contactId, professionalPhone, profOutboundId]
      ),
      /check/i
    );
    await assert.rejects(
      query(
        `INSERT INTO interactive_action_tokens (
          public_token, action_type, contact_id, completion_id, intended_actor_role,
          intended_phone_e164, outbound_message_id, status, expires_at
        ) VALUES ($1, 'declare_completion', $2, NULL, 'professional', $3, $4, 'active', NOW() + INTERVAL '1 day')`,
        [" ia_token_leading", contactId, professionalPhone, profOutboundId]
      ),
      /check/i
    );
    await assert.rejects(
      query(
        `INSERT INTO interactive_action_tokens (
          public_token, action_type, contact_id, completion_id, intended_actor_role,
          intended_phone_e164, outbound_message_id, status, expires_at
        ) VALUES ($1, 'declare_completion', $2, NULL, 'professional', $3, $4, 'active', NOW() + INTERVAL '1 day')`,
        ["ia_token_trailing\n", contactId, professionalPhone, profOutboundId]
      ),
      /check/i
    );

    // Token with length > 120 rejected
    const tooLongToken = "ia_" + "a".repeat(118); // 121 characters
    await assert.rejects(
      query(
        `INSERT INTO interactive_action_tokens (
          public_token, action_type, contact_id, completion_id, intended_actor_role,
          intended_phone_e164, outbound_message_id, status, expires_at
        ) VALUES ($1, 'declare_completion', $2, NULL, 'professional', $3, $4, 'active', NOW() + INTERVAL '1 day')`,
        [tooLongToken, contactId, professionalPhone, profOutboundId]
      )
    );

    // Token with exact length 120 accepted
    const exact120Token = "ia_" + "b".repeat(117); // 120 characters
    await query(
      `INSERT INTO interactive_action_tokens (
        public_token, action_type, contact_id, completion_id, intended_actor_role,
        intended_phone_e164, outbound_message_id, status, expires_at
      ) VALUES ($1, 'declare_completion', $2, NULL, 'professional', $3, $4, 'active', NOW() + INTERVAL '1 day')`,
      [exact120Token, contactId, professionalPhone, profOutboundId]
    );
    await query("DELETE FROM interactive_action_tokens WHERE public_token = $1", [exact120Token]);

    // P. Public token uniqueness enforced
    await assert.rejects(
      query(
        `INSERT INTO interactive_action_tokens (
          public_token, action_type, contact_id, completion_id, intended_actor_role,
          intended_phone_e164, outbound_message_id, status, expires_at
        ) VALUES ($1, 'declare_completion', $2, NULL, 'professional', $3, $4, 'active', NOW() + INTERVAL '1 day')`,
        [tokenDeclComp, contactId, professionalPhone, profOutboundId]
      ),
      (err: unknown) => (err as { code?: string }).code === "23505"
    );

    // Q. Outbound FK enforced
    await assert.rejects(
      query(
        `INSERT INTO interactive_action_tokens (
          public_token, action_type, contact_id, completion_id, intended_actor_role,
          intended_phone_e164, outbound_message_id, status, expires_at
        ) VALUES ($1, 'declare_completion', $2, NULL, 'professional', $3, $4, 'active', NOW() + INTERVAL '1 day')`,
        ["ia_" + randomUUID().replaceAll("-", ""), contactId, professionalPhone, randomUUID()]
      ),
      (err: unknown) => (err as { code?: string }).code === "23503"
    );

    // R. Inbound consumed FK enforced
    await assert.rejects(
      query(
        `INSERT INTO interactive_action_tokens (
          public_token, action_type, contact_id, completion_id, intended_actor_role,
          intended_phone_e164, outbound_message_id, status, expires_at, consumed_at, consumed_inbound_id
        ) VALUES ($1, 'declare_completion', $2, NULL, 'professional', $3, $4, 'consumed', NOW() + INTERVAL '1 day', NOW(), $5)`,
        ["ia_" + randomUUID().replaceAll("-", ""), contactId, professionalPhone, profOutboundId, randomUUID()]
      ),
      (err: unknown) => (err as { code?: string }).code === "23503"
    );

    // S. Completion <-> Contact mismatch rejected by composite FK
    await query(
      `INSERT INTO contacts (id, search_request_id, customer_id, professional_id, status)
       VALUES ($1, $2, $3, $4, 'shared')`,
      [contactIdB, searchId, customerId, professionalId]
    );

    // Attempting to create token with contact_id = contactIdB but completion_id belonging to contactId -> rejected by composite FK!
    await assert.rejects(
      query(
        `INSERT INTO interactive_action_tokens (
          public_token, action_type, contact_id, completion_id, intended_actor_role,
          intended_phone_e164, outbound_message_id, status, expires_at
        ) VALUES ($1, 'confirm_completion', $2, $3, 'customer', $4, $5, 'active', NOW() + INTERVAL '1 day')`,
        ["ia_" + randomUUID().replaceAll("-", ""), contactIdB, completionId, customerPhone, customerOutboundId]
      ),
      (err: unknown) => (err as { code?: string }).code === "23503"
    );
  } finally {
    await query("DELETE FROM interactive_action_tokens WHERE contact_id IN ($1, $2)", [contactId, contactIdB]);
    await query("DELETE FROM channel_outbound_messages WHERE id IN ($1, $2)", [customerOutboundId, profOutboundId]);
    await query("DELETE FROM channel_inbound_messages WHERE id = $1", [inboundId]);
    await query("DELETE FROM contact_completions WHERE id = $1", [completionId]);
    await query("DELETE FROM contacts WHERE id IN ($1, $2)", [contactId, contactIdB]);
    await query("DELETE FROM search_requests WHERE id = $1", [searchId]);
    await query("DELETE FROM professionals WHERE id = $1", [professionalId]);
    await query("DELETE FROM customers WHERE id = $1", [customerId]);
  }
});

test("Scenario T & X: Compatible rollback with zero interactive data and clean reapplication", async () => {
  await migrateUp();

  // Ensure no interactive fixtures exist
  await query("DELETE FROM interactive_action_tokens");
  await query("DELETE FROM channel_outbound_messages WHERE message_type = 'interactive' OR interactive_payload IS NOT NULL");
  await query("UPDATE channel_inbound_messages SET interactive_action_id = NULL WHERE interactive_action_id IS NOT NULL");

  // Roll back 028 to 027
  await rollbackThrough("028_add_interactive_actions_foundation");

  // Assert schema 027 state after down:
  const is028Present = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM pgmigrations WHERE name = '028_add_interactive_actions_foundation'"
  )).rows[0].cnt;
  assert.equal(is028Present, 0, "028 must be removed from pgmigrations");

  const tableExists = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM information_schema.tables WHERE table_name = 'interactive_action_tokens'"
  )).rows[0].cnt;
  assert.equal(tableExists, 0, "interactive_action_tokens table must be dropped");

  const outboundCol = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM information_schema.columns WHERE table_name = 'channel_outbound_messages' AND column_name = 'interactive_payload'"
  )).rows[0].cnt;
  assert.equal(outboundCol, 0, "interactive_payload column must be dropped");

  const inboundCol = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM information_schema.columns WHERE table_name = 'channel_inbound_messages' AND column_name = 'interactive_action_id'"
  )).rows[0].cnt;
  assert.equal(inboundCol, 0, "interactive_action_id column must be dropped");

  // Old text-only constraint restored in schema 027
  const oldConstraintRestored = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM pg_constraint WHERE conname = 'channel_outbound_messages_message_type_check'"
  )).rows[0].cnt;
  assert.equal(oldConstraintRestored, 1, "channel_outbound_messages_message_type_check must be restored under 027");

  const newConstraintRemoved = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM pg_constraint WHERE conname = 'channel_outbound_messages_message_type_payload_chk'"
  )).rows[0].cnt;
  assert.equal(newConstraintRemoved, 0, "channel_outbound_messages_message_type_payload_chk must be removed after rollback");

  // Reapply 028 (Scenario X)
  await migrateUp(1);

  const is028Reapplied = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM pgmigrations WHERE name = '028_add_interactive_actions_foundation'"
  )).rows[0].cnt;
  assert.equal(is028Reapplied, 1, "028 must be reapplied cleanly");

  const newConstraintReapplied = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM pg_constraint WHERE conname = 'channel_outbound_messages_message_type_payload_chk'"
  )).rows[0].cnt;
  assert.equal(newConstraintReapplied, 1, "channel_outbound_messages_message_type_payload_chk must be reapplied");
});

test("Scenario U: P0028 rollback blocker when interactive_action_tokens rows exist", async () => {
  await migrateUp();

  const customerId = randomUUID(), professionalId = randomUUID(), searchId = randomUUID(), contactId = randomUUID();
  const inboundId = randomUUID(), outboundId = randomUUID(), tokenId = randomUUID();
  const customerPhone = phone(), professionalPhone = phone();
  const opaqueTokenU = "ia_" + randomUUID().replaceAll("-", "");

  try {
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [customerId, customerPhone]);
    await query("INSERT INTO professionals (id, display_name, slug, phone_e164, status) VALUES ($1::uuid, 'Prof U', $1::text, $2, 'active')", [professionalId, professionalPhone]);
    await query("INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1, $2, 'eletricista', 'selected')", [searchId, customerId]);
    await query("INSERT INTO contacts (id, search_request_id, customer_id, professional_id, status) VALUES ($1, $2, $3, $4, 'shared')", [contactId, searchId, customerId, professionalId]);
    await query("INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text) VALUES ($1::uuid, 'test', $1::text, $2, 'inbound')", [inboundId, customerPhone]);

    // Note: Text outbound is intentionally used here to isolate the token-row rollback blocker without triggering the interactive-outbound rollback blocker.
    await query("INSERT INTO channel_outbound_messages (id, channel_inbound_message_id, provider, recipient_phone_e164, message_type, text_content, status) VALUES ($1, $2, 'test', $3, 'text', 'txt', 'pending')", [outboundId, inboundId, customerPhone]);

    await query(
      `INSERT INTO interactive_action_tokens (
        id, public_token, action_type, contact_id, completion_id, intended_actor_role,
        intended_phone_e164, outbound_message_id, status, expires_at
      ) VALUES ($1, $2, 'declare_completion', $3, NULL, 'professional', $4, $5, 'active', NOW() + INTERVAL '1 day')`,
      [tokenId, opaqueTokenU, contactId, professionalPhone, outboundId]
    );

    let rollbackErr: unknown = null;
    try {
      await rollbackThrough("028_add_interactive_actions_foundation");
    } catch (e) {
      rollbackErr = e;
    }

    assert.ok(rollbackErr, "rollbackThrough must throw when token data exists");
    const errObj = rollbackErr as { stderr?: string; message?: string };
    assert.match(String(errObj.stderr || errObj.message), /INTERACTIVE_ACTIONS_ROLLBACK_BLOCKED/);
    assert.match(String(errObj.stderr || errObj.message), /P0028/);

    // Data remains intact
    const tokenExists = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM interactive_action_tokens WHERE id = $1",
      [tokenId]
    )).rows[0].cnt;
    assert.equal(tokenExists, 1, "Token must remain intact after blocked rollback");
  } finally {
    await query("DELETE FROM interactive_action_tokens WHERE id = $1", [tokenId]);
    await query("DELETE FROM channel_outbound_messages WHERE id = $1", [outboundId]);
    await query("DELETE FROM channel_inbound_messages WHERE id = $1", [inboundId]);
    await query("DELETE FROM contacts WHERE id = $1", [contactId]);
    await query("DELETE FROM search_requests WHERE id = $1", [searchId]);
    await query("DELETE FROM professionals WHERE id = $1", [professionalId]);
    await query("DELETE FROM customers WHERE id = $1", [customerId]);
    await migrateUp();
  }
});

test("Scenario V: P0028 rollback blocker when interactive outbound message exists", async () => {
  await migrateUp();

  const customerPhone = phone();
  const inboundId = randomUUID();
  const outboundId = randomUUID();
  const opaqueActionId = "ia_" + randomUUID().replaceAll("-", "");

  const payload = {
    schema_version: 1,
    type: "button_group",
    body: "Mensagem interativa",
    actions: [{ action_id: opaqueActionId, label: "Confirmar" }],
  };

  try {
    await query(
      `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text)
       VALUES ($1::uuid, 'test', $1::text, $2, 'inbound v')`,
      [inboundId, customerPhone]
    );
    await query(
      `INSERT INTO channel_outbound_messages (id, channel_inbound_message_id, provider, recipient_phone_e164, message_type, text_content, interactive_payload, status)
       VALUES ($1, $2, 'test', $3, 'interactive', 'Interactive Outbound', $4::jsonb, 'pending')`,
      [outboundId, inboundId, customerPhone, JSON.stringify(payload)]
    );

    let rollbackErr: unknown = null;
    try {
      await rollbackThrough("028_add_interactive_actions_foundation");
    } catch (e) {
      rollbackErr = e;
    }

    assert.ok(rollbackErr, "rollbackThrough must throw when interactive outbound exists");
    const errObj = rollbackErr as { stderr?: string; message?: string };
    assert.match(String(errObj.stderr || errObj.message), /INTERACTIVE_ACTIONS_ROLLBACK_BLOCKED/);
    assert.match(String(errObj.stderr || errObj.message), /P0028/);
  } finally {
    await query("DELETE FROM channel_outbound_messages WHERE id = $1", [outboundId]);
    await query("DELETE FROM channel_inbound_messages WHERE id = $1", [inboundId]);
    await migrateUp();
  }
});

test("Scenario W: P0028 rollback blocker when inbound interactive_action_id is populated", async () => {
  await migrateUp();

  const customerPhone = phone();
  const inboundId = randomUUID();
  const opaqueInboundActionId = "ia_" + randomUUID().replaceAll("-", "");

  try {
    await query(
      `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text, interactive_action_id)
       VALUES ($1::uuid, 'test', $1::text, $2, 'Confirmar', $3)`,
      [inboundId, customerPhone, opaqueInboundActionId]
    );

    let rollbackErr: unknown = null;
    try {
      await rollbackThrough("028_add_interactive_actions_foundation");
    } catch (e) {
      rollbackErr = e;
    }

    assert.ok(rollbackErr, "rollbackThrough must throw when inbound interactive_action_id exists");
    const errObj = rollbackErr as { stderr?: string; message?: string };
    assert.match(String(errObj.stderr || errObj.message), /INTERACTIVE_ACTIONS_ROLLBACK_BLOCKED/);
    assert.match(String(errObj.stderr || errObj.message), /P0028/);
  } finally {
    await query("DELETE FROM channel_inbound_messages WHERE id = $1", [inboundId]);
    await migrateUp();
  }
});

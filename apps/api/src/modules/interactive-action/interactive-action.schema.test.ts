import assert from "node:assert/strict";
import { test } from "node:test";
import {
  interactiveActionTypeSchema,
  interactiveActionTokenStatusSchema,
  interactiveOutboundActionSchema,
  interactiveOutboundPayloadSchema,
} from "@contatocerto/shared";

test("interactiveActionTypeSchema validates all 4 v1 actions and rejects invalid ones", () => {
  const validTypes = [
    "declare_completion",
    "declare_unavailability",
    "confirm_completion",
    "contest_completion",
  ];

  for (const t of validTypes) {
    assert.equal(interactiveActionTypeSchema.parse(t), t);
  }

  assert.throws(() => interactiveActionTypeSchema.parse("choose_professional"));
  assert.throws(() => interactiveActionTypeSchema.parse("invalid_action"));
  assert.throws(() => interactiveActionTypeSchema.parse(""));
  assert.throws(() => interactiveActionTypeSchema.parse(null));
});

test("interactiveActionTokenStatusSchema validates all 4 token statuses and rejects invalid ones", () => {
  const validStatuses = ["active", "consumed", "revoked", "expired"];

  for (const s of validStatuses) {
    assert.equal(interactiveActionTokenStatusSchema.parse(s), s);
  }

  assert.throws(() => interactiveActionTokenStatusSchema.parse("pending"));
  assert.throws(() => interactiveActionTokenStatusSchema.parse("draft"));
  assert.throws(() => interactiveActionTokenStatusSchema.parse(""));
  assert.throws(() => interactiveActionTokenStatusSchema.parse(null));
});

test("interactiveOutboundActionSchema requires non-empty action_id and label, strictly rejecting extra fields", () => {
  const validAction = {
    action_id: "ia_token_12345",
    label: "Confirmar",
  };

  const parsed = interactiveOutboundActionSchema.parse(validAction);
  assert.deepEqual(parsed, validAction);

  // Rejects empty action_id
  assert.throws(() =>
    interactiveOutboundActionSchema.parse({
      action_id: "",
      label: "Confirmar",
    })
  );

  // Rejects empty or whitespace-only label
  assert.throws(() =>
    interactiveOutboundActionSchema.parse({
      action_id: "ia_token_12345",
      label: "",
    })
  );
  assert.throws(() =>
    interactiveOutboundActionSchema.parse({
      action_id: "ia_token_12345",
      label: "   ",
    })
  );

  // Rejects extra/provider-specific fields (e.g. style, color, type)
  assert.throws(() =>
    interactiveOutboundActionSchema.parse({
      action_id: "ia_token_12345",
      label: "Confirmar",
      style: "primary",
    })
  );
});

test("interactiveOutboundPayloadSchema validates valid customer and professional payloads", () => {
  // Customer Confirmar / Contestar payload
  const customerPayload = {
    schema_version: 1,
    type: "button_group",
    body: "O profissional declarou a conclusão do serviço CC-98765432. Por favor, confirme:",
    actions: [
      { action_id: "ia_confirm_abc", label: "Confirmar" },
      { action_id: "ia_contest_xyz", label: "Contestar" },
    ],
  };

  const parsedCustomer = interactiveOutboundPayloadSchema.parse(customerPayload);
  assert.deepEqual(parsedCustomer, customerPayload);

  // Professional Concluído / Não consigo atender payload
  const profPayload = {
    schema_version: 1,
    type: "button_group",
    body: "Informações do atendimento CC-12345678. Escolha uma opção:",
    actions: [
      { action_id: "ia_done_111", label: "Concluído" },
      { action_id: "ia_unavail_222", label: "Não consigo atender" },
    ],
  };

  const parsedProf = interactiveOutboundPayloadSchema.parse(profPayload);
  assert.deepEqual(parsedProf, profPayload);
});

test("interactiveOutboundPayloadSchema strictly enforces schema_version = 1 and button_group type", () => {
  const base = {
    type: "button_group",
    body: "Mensagem de teste",
    actions: [{ action_id: "ia_1", label: "Ação 1" }],
  };

  // Missing schema_version
  assert.throws(() => interactiveOutboundPayloadSchema.parse(base));

  // Invalid schema_version
  assert.throws(() =>
    interactiveOutboundPayloadSchema.parse({ ...base, schema_version: 2 })
  );
  assert.throws(() =>
    interactiveOutboundPayloadSchema.parse({ ...base, schema_version: "1" })
  );

  // Invalid type
  assert.throws(() =>
    interactiveOutboundPayloadSchema.parse({
      ...base,
      schema_version: 1,
      type: "list_picker",
    })
  );

  // Empty actions array
  assert.throws(() =>
    interactiveOutboundPayloadSchema.parse({
      ...base,
      schema_version: 1,
      actions: [],
    })
  );

  // Empty body
  assert.throws(() =>
    interactiveOutboundPayloadSchema.parse({
      ...base,
      schema_version: 1,
      body: "",
    })
  );

  // Provider-specific arbitrary fields rejected by strict schema
  assert.throws(() =>
    interactiveOutboundPayloadSchema.parse({
      ...base,
      schema_version: 1,
      provider: "evolution",
      buttons: [{ id: "b1", text: "Clique aqui" }],
    })
  );
});

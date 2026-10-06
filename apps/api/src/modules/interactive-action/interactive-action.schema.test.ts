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

test("interactiveOutboundActionSchema requires valid action_id and label, strictly rejecting extra fields, whitespace, and length > 120", () => {
  const validAction = {
    action_id: "ia_7f9a1b2c3d4e5f6a",
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

  // Rejects action_id with whitespace (leading, trailing, internal, tab, newline)
  assert.throws(() =>
    interactiveOutboundActionSchema.parse({
      action_id: "ia 7f9a1b2c",
      label: "Confirmar",
    })
  );
  assert.throws(() =>
    interactiveOutboundActionSchema.parse({
      action_id: " ia_7f9a1b2c",
      label: "Confirmar",
    })
  );
  assert.throws(() =>
    interactiveOutboundActionSchema.parse({
      action_id: "ia_7f9a1b2c ",
      label: "Confirmar",
    })
  );
  assert.throws(() =>
    interactiveOutboundActionSchema.parse({
      action_id: "ia_\t7f9a1b2c",
      label: "Confirmar",
    })
  );
  assert.throws(() =>
    interactiveOutboundActionSchema.parse({
      action_id: "ia_\n7f9a1b2c",
      label: "Confirmar",
    })
  );

  // Rejects action_id longer than 120 characters
  const tooLong = "ia_" + "a".repeat(118); // 121 chars
  assert.throws(() =>
    interactiveOutboundActionSchema.parse({
      action_id: tooLong,
      label: "Confirmar",
    })
  );

  // Accepts valid action_id of exactly 120 characters
  const exactly120 = "ia_" + "a".repeat(117); // 120 chars
  assert.equal(
    interactiveOutboundActionSchema.parse({
      action_id: exactly120,
      label: "Confirmar",
    }).action_id,
    exactly120
  );

  // Rejects empty or whitespace-only label
  assert.throws(() =>
    interactiveOutboundActionSchema.parse({
      action_id: "ia_7f9a1b2c3d4e5f6a",
      label: "",
    })
  );
  assert.throws(() =>
    interactiveOutboundActionSchema.parse({
      action_id: "ia_7f9a1b2c3d4e5f6a",
      label: "   ",
    })
  );

  // Rejects extra/provider-specific fields (e.g. style, color, type)
  assert.throws(() =>
    interactiveOutboundActionSchema.parse({
      action_id: "ia_7f9a1b2c3d4e5f6a",
      label: "Confirmar",
      style: "primary",
    })
  );
});

test("interactiveOutboundPayloadSchema validates valid customer and professional payloads with opaque tokens", () => {
  // Customer Confirmar / Contestar payload with semantically opaque action IDs
  const customerPayload = {
    schema_version: 1,
    type: "button_group",
    body: "O profissional declarou a conclusão do serviço CC-98765432. Por favor, confirme:",
    actions: [
      { action_id: "ia_7f9a1b2c3d4e5f6a", label: "Confirmar" },
      { action_id: "ia_a8c42170d95b31e4", label: "Contestar" },
    ],
  };

  const parsedCustomer = interactiveOutboundPayloadSchema.parse(customerPayload);
  assert.deepEqual(parsedCustomer, customerPayload);

  // Professional Concluído / Não consigo atender payload with semantically opaque action IDs
  const profPayload = {
    schema_version: 1,
    type: "button_group",
    body: "Informações do atendimento CC-12345678. Escolha uma opção:",
    actions: [
      { action_id: "ia_3b91c0e812d4a57f", label: "Concluído" },
      { action_id: "ia_e2194a0f6c7b8d3e", label: "Não consigo atender" },
    ],
  };

  const parsedProf = interactiveOutboundPayloadSchema.parse(profPayload);
  assert.deepEqual(parsedProf, profPayload);
});

test("interactiveOutboundPayloadSchema enforces unique action_id within payload actions", () => {
  // Duplicate action_id rejected
  const duplicatePayload = {
    schema_version: 1,
    type: "button_group",
    body: "Escolha uma opção:",
    actions: [
      { action_id: "ia_7f9a1b2c3d4e5f6a", label: "Confirmar" },
      { action_id: "ia_7f9a1b2c3d4e5f6a", label: "Contestar" },
    ],
  };
  assert.throws(() => interactiveOutboundPayloadSchema.parse(duplicatePayload));

  // Identical labels with different action_ids are allowed
  const sameLabelPayload = {
    schema_version: 1,
    type: "button_group",
    body: "Escolha uma opção:",
    actions: [
      { action_id: "ia_7f9a1b2c3d4e5f6a", label: "Opção" },
      { action_id: "ia_a8c42170d95b31e4", label: "Opção" },
    ],
  };
  assert.deepEqual(
    interactiveOutboundPayloadSchema.parse(sameLabelPayload),
    sameLabelPayload
  );
});

test("interactiveOutboundPayloadSchema strictly enforces schema_version = 1 and button_group type", () => {
  const base = {
    type: "button_group",
    body: "Mensagem de teste",
    actions: [{ action_id: "ia_7f9a1b2c3d4e5f6a", label: "Ação 1" }],
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

test("interactiveOutboundPayloadSchema validates template_quick_reply with 4 body parameters and language_code", () => {
  const validTemplatePayload = {
    schema_version: 1,
    type: "template_quick_reply",
    template_name: "contato_certo_nova_solicitacao_v1",
    language_code: "pt_BR",
    body_parameters: [
      "Cliente",
      "Sinop / MT",
      "Eletricista",
      "Troca de fiação. Telefone do cliente: +5511999999999 Ref.: CC-12345678",
    ],
    actions: [
      { action_id: "ia_111111111111111111111111111111111111111111111111", label: "Concluído" },
      { action_id: "ia_222222222222222222222222222222222222222222222222", label: "Não consigo atender" },
    ],
  };

  const parsed = interactiveOutboundPayloadSchema.parse(validTemplatePayload);
  assert.equal(parsed.type, "template_quick_reply");
  if (parsed.type === "template_quick_reply") {
    assert.equal(parsed.language_code, "pt_BR");
    assert.equal(parsed.body_parameters.length, 4);
    assert.equal(parsed.actions.length, 2);
  }

  // Fails closed when an empty parameter or whitespace-only parameter is supplied
  assert.throws(() =>
    interactiveOutboundPayloadSchema.parse({
      ...validTemplatePayload,
      body_parameters: ["Cliente", "Sinop", "", "Detalhes"],
    })
  );

  assert.throws(() =>
    interactiveOutboundPayloadSchema.parse({
      ...validTemplatePayload,
      body_parameters: ["Cliente", "Sinop", "   ", "Detalhes"],
    })
  );

  // Rejects invalid language_code format
  assert.throws(() =>
    interactiveOutboundPayloadSchema.parse({
      ...validTemplatePayload,
      language_code: "invalid_lang",
    })
  );

  // Rejects old 'language' key if language_code is missing
  const payloadWithOldLangKey = {
    schema_version: validTemplatePayload.schema_version,
    type: validTemplatePayload.type,
    template_name: validTemplatePayload.template_name,
    language: "pt_BR",
    body_parameters: validTemplatePayload.body_parameters,
    actions: validTemplatePayload.actions,
  };
  assert.throws(() =>
    interactiveOutboundPayloadSchema.parse(payloadWithOldLangKey)
  );
});

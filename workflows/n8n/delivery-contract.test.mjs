import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { runInNewContext } from "node:vm";
import {
  claimDecision,
  buildEvolutionSendRequest,
  transportDecision,
  confirmationDecision,
  normalizeEvolutionText,
  normalizeBrazilianMobilePhone,
  VALID_BRAZILIAN_DDDS,
} from "./delivery-contract.mjs";
import {
  normalizeBrazilianMobilePhone as sharedNormalizeBrazilianMobilePhone,
  VALID_BRAZILIAN_DDDS as sharedValidDDDs,
} from "../../packages/shared/dist/index.js";

const message = (recipient_phone_e164 = "+5566991234567") => ({
  id: randomUUID(),
  status: "processing",
  attempt_count: 1,
  purpose: "professional_contact_notification",
  provider: "evolution",
  recipient_phone_e164,
  message_type: "text",
  text_content: "Contato confirmado.\nMensagem com aspas: \"olá\" 😊",
  processing_token: randomUUID(),
});

const interactiveMessage = (recipient_phone_e164 = "+5566991234567", actions = [
  { action_id: "ia_111111111111111111111111111111111111111111111111", label: "Concluído" },
  { action_id: "ia_222222222222222222222222222222222222222222222222", label: "Não consigo atender" },
]) => ({
  id: randomUUID(),
  status: "processing",
  attempt_count: 1,
  purpose: "professional_contact_notification",
  provider: "evolution",
  recipient_phone_e164,
  message_type: "interactive",
  text_content: "Detalhes da solicitação...",
  interactive_payload: {
    schema_version: 1,
    type: "button_group",
    body: "Detalhes da solicitação...",
    actions,
  },
  processing_token: randomUUID(),
});

const response = (body, statusCode = 200) => ({ statusCode, body });

test("interactive claim accepted and preserves payload, 1..3 actions, and text fallback", () => {
  const item = interactiveMessage();
  const decision = claimDecision(response(item), "evolution");
  assert.equal(decision.action, "send");
  assert.equal(decision.message.message_type, "interactive");
  assert.equal(decision.message.text_content, item.text_content);
  assert.equal(decision.message.interactive_payload.body, item.interactive_payload.body);
  assert.equal(decision.message.interactive_payload.actions.length, 2);
  assert.equal(decision.message.interactive_payload.actions[0].action_id, "ia_111111111111111111111111111111111111111111111111");
  assert.equal(decision.message.interactive_payload.actions[0].label, "Concluído");
  assert.equal(decision.message.interactive_payload.actions[1].action_id, "ia_222222222222222222222222222222222222222222222222");
  assert.equal(decision.message.interactive_payload.actions[1].label, "Não consigo atender");
});

test("interactive claim validation rejects malformed payloads and out-of-spec actions", () => {
  const base = interactiveMessage();

  // Missing or wrong schema_version
  assert.throws(() => claimDecision(response({ ...base, interactive_payload: { ...base.interactive_payload, schema_version: 2 } }), "evolution"), /claim_invalid/u);

  // Missing or wrong type
  assert.throws(() => claimDecision(response({ ...base, interactive_payload: { ...base.interactive_payload, type: "list" } }), "evolution"), /claim_invalid/u);

  // Empty or non-string body
  assert.throws(() => claimDecision(response({ ...base, interactive_payload: { ...base.interactive_payload, body: "" } }), "evolution"), /claim_invalid/u);
  assert.throws(() => claimDecision(response({ ...base, interactive_payload: { ...base.interactive_payload, body: 123 } }), "evolution"), /claim_invalid/u);

  // Empty actions array
  assert.throws(() => claimDecision(response({ ...base, interactive_payload: { ...base.interactive_payload, actions: [] } }), "evolution"), /claim_invalid/u);

  // > 3 actions (4 actions)
  assert.throws(() => claimDecision(response({
    ...base,
    interactive_payload: {
      ...base.interactive_payload,
      actions: [
        { action_id: "ia_1", label: "A" },
        { action_id: "ia_2", label: "B" },
        { action_id: "ia_3", label: "C" },
        { action_id: "ia_4", label: "D" },
      ],
    },
  }), "evolution"), /claim_invalid/u);

  // Duplicate action IDs
  assert.throws(() => claimDecision(response({
    ...base,
    interactive_payload: {
      ...base.interactive_payload,
      actions: [
        { action_id: "ia_dup", label: "Opção 1" },
        { action_id: "ia_dup", label: "Opção 2" },
      ],
    },
  }), "evolution"), /claim_invalid/u);

  // Action ID with whitespace
  assert.throws(() => claimDecision(response({
    ...base,
    interactive_payload: {
      ...base.interactive_payload,
      actions: [{ action_id: "ia_ invalid", label: "Opção" }],
    },
  }), "evolution"), /claim_invalid/u);

  // Action ID too long (>120)
  assert.throws(() => claimDecision(response({
    ...base,
    interactive_payload: {
      ...base.interactive_payload,
      actions: [{ action_id: "a".repeat(121), label: "Opção" }],
    },
  }), "evolution"), /claim_invalid/u);

  // Label > 20 characters (WhatsApp reply button limit)
  assert.throws(() => claimDecision(response({
    ...base,
    interactive_payload: {
      ...base.interactive_payload,
      actions: [{ action_id: "ia_1", label: "123456789012345678901" }],
    },
  }), "evolution"), /claim_invalid/u);

  // Empty label
  assert.throws(() => claimDecision(response({
    ...base,
    interactive_payload: {
      ...base.interactive_payload,
      actions: [{ action_id: "ia_1", label: "   " }],
    },
  }), "evolution"), /claim_invalid/u);

  // Text message with interactive_payload present throws error
  assert.throws(() => claimDecision(response({
    ...message(),
    interactive_payload: base.interactive_payload,
  }), "evolution"), /claim_invalid/u);

  // Valid template_quick_reply claim
  const templateItem = {
    ...base,
    interactive_payload: {
      schema_version: 1,
      type: "template_quick_reply",
      template_name: "contato_certo_nova_solicitacao_v1",
      language_code: "pt_BR",
      body_parameters: ["Eletricista", "Sinop / MT", "Instalação de chuveiro", "+5511888888888", "CC-12345678"],
      actions: [
        { action_id: "ia_111111111111111111111111111111111111111111111111", label: "Concluído" },
        { action_id: "ia_222222222222222222222222222222222222222222222222", label: "Não consigo atender" },
      ],
    },
  };
  const templateDecision = claimDecision(response(templateItem), "evolution");
  assert.equal(templateDecision.action, "send");
  assert.equal(templateDecision.message.interactive_payload.type, "template_quick_reply");
  assert.equal(templateDecision.message.interactive_payload.template_name, "contato_certo_nova_solicitacao_v1");
  assert.equal(templateDecision.message.interactive_payload.language_code, "pt_BR");
  assert.deepEqual(templateDecision.message.interactive_payload.body_parameters, ["Eletricista", "Sinop / MT", "Instalação de chuveiro", "+5511888888888", "CC-12345678"]);
  assert.equal(templateDecision.message.interactive_payload.actions.length, 2);

  // Invalid template name
  assert.throws(() => claimDecision(response({
    ...templateItem,
    interactive_payload: { ...templateItem.interactive_payload, template_name: "Invalid-Name!" },
  }), "evolution"), /claim_invalid/u);

  // Invalid template language_code
  assert.throws(() => claimDecision(response({
    ...templateItem,
    interactive_payload: { ...templateItem.interactive_payload, language_code: "invalid-lang" },
  }), "evolution"), /claim_invalid/u);

  // Invalid body parameters (empty parameter)
  assert.throws(() => claimDecision(response({
    ...templateItem,
    interactive_payload: { ...templateItem.interactive_payload, body_parameters: [""] },
  }), "evolution"), /claim_invalid/u);
});

test("buildEvolutionSendRequest creates accurate endpoints and bodies for text and interactive", () => {
  // 1. Text message
  const textMsg = message("+5566991234567");
  const textReq = buildEvolutionSendRequest(textMsg, "pilot-instance");
  assert.equal(textReq.endpoint, "/message/sendText/pilot-instance");
  assert.deepEqual(textReq.body, {
    number: "5566991234567",
    text: textMsg.text_content,
  });

  // 2. Interactive message (button_group)
  const interMsg = interactiveMessage("+5566991234567");
  const interReq = buildEvolutionSendRequest(interMsg, "pilot-instance");
  assert.equal(interReq.endpoint, "/message/sendButtons/pilot-instance");
  assert.equal(interReq.body.number, "5566991234567");
  // Placed in Evolution 2.3.7-compatible title field
  assert.equal(interReq.body.title, interMsg.interactive_payload.body);
  assert.deepEqual(interReq.body.buttons, [
    {
      type: "reply",
      displayText: "Concluído",
      id: "ia_111111111111111111111111111111111111111111111111",
    },
    {
      type: "reply",
      displayText: "Não consigo atender",
      id: "ia_222222222222222222222222222222222222222222222222",
    },
  ]);

  // 3. Interactive message (template_quick_reply)
  const templateMsg = {
    ...interMsg,
    interactive_payload: {
      schema_version: 1,
      type: "template_quick_reply",
      template_name: "contato_certo_nova_solicitacao_v1",
      language_code: "pt_BR",
      body_parameters: ["Eletricista", "Sinop / MT", "Quadro de força", "+5511888888888", "CC-12345678"],
      actions: [
        { action_id: "ia_111111111111111111111111111111111111111111111111", label: "Concluído" },
        { action_id: "ia_222222222222222222222222222222222222222222222222", label: "Não consigo atender" },
      ],
    },
  };
  const templateReq = buildEvolutionSendRequest(templateMsg, "contato-certo-oficial");
  assert.equal(templateReq.endpoint, "/message/sendTemplate/contato-certo-oficial");
  assert.deepEqual(templateReq.body, {
    number: "5566991234567",
    name: "contato_certo_nova_solicitacao_v1",
    language: "pt_BR",
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: "Eletricista" },
          { type: "text", text: "Sinop / MT" },
          { type: "text", text: "Quadro de força" },
          { type: "text", text: "+5511888888888" },
          { type: "text", text: "CC-12345678" },
        ],
      },
      {
        type: "button",
        sub_type: "quick_reply",
        index: "0",
        parameters: [
          {
            type: "payload",
            payload: "ia_111111111111111111111111111111111111111111111111",
          },
        ],
      },
      {
        type: "button",
        sub_type: "quick_reply",
        index: "1",
        parameters: [
          {
            type: "payload",
            payload: "ia_222222222222222222222222222222222222222222222222",
          },
        ],
      },
    ],
  });

  // Invalid instance
  assert.throws(() => buildEvolutionSendRequest(textMsg, ""), /channel_instance_not_allowed/u);
});

test("empty, already sent and busy claims never authorize transport", () => {
  assert.equal(claimDecision(response(null, 204), "evolution").action, "stop");
  assert.equal(claimDecision(response(null, 409), "evolution").action, "stop");
  const sent = message();
  assert.equal(claimDecision(response({ id: sent.id, status: "sent", attempt_count: 1, purpose: sent.purpose }), "evolution").action, "stop");
  for (const body of [{ ...sent, processing_token: undefined }, { ...sent, provider: "other" }, { ...sent, text_content: "" }]) {
    assert.throws(() => claimDecision(response(body), "evolution"), /claim_invalid/u);
  }
});

test("delivery preserves recipient and content from each claimed message, including independent purposes", () => {
  for (const purpose of ["customer_reply", "professional_contact_notification", "professional_reply", "customer_contact_update", "channel_notice"]) {
    const item = { ...message(), purpose };
    const decision = claimDecision(response(item), "evolution");
    assert.equal(decision.message.text_content, item.text_content);
    assert.equal(decision.message.recipient_phone_e164, item.recipient_phone_e164);
    assert.equal(decision.message.processing_token, item.processing_token);
    assert.equal(decision.message.purpose, purpose);
  }
  assert.throws(() => claimDecision(response({ ...message(), purpose: "unknown" }), "evolution"), /claim_invalid/u);
  // professional_auth_challenge as text MUST fail closed (never fallback to sendText)
  assert.throws(() => claimDecision(response({ ...message(), purpose: "professional_auth_challenge" }), "evolution"), /claim_invalid/u);
});

test("acceptance must match the recipient and provider message id; only proven rejection goes to failed", () => {
  const item = message();
  const accepted = response({ key: { id: "provider-1", fromMe: true, remoteJid: "5566991234567@s.whatsapp.net" } }, 201);
  assert.deepEqual(transportDecision(accepted, item), { action: "sent", payload: { processing_token: item.processing_token, provider_message_id: "provider-1" } });
  for (const result of [response({}, 200), response({}, 500), {}, { error: "timeout" },
    response({ key: { ...accepted.body.key, remoteJid: "another-recipient@s.whatsapp.net" } })]) {
    assert.equal(transportDecision(result, item).action, "hold");
  }
  assert.equal(transportDecision(response({}, 429), item).action, "hold");
});

test("outbound transport decision mandatory matrix (Cases 1-14)", () => {
  const claimedProf = message("+5566999029086");

  // Case 1: claimed +5566999029086, response 5566999029086@s.whatsapp.net => sent
  const case1 = transportDecision(
    response({ key: { id: "msg-1", fromMe: true, remoteJid: "5566999029086@s.whatsapp.net" } }, 200),
    claimedProf,
  );
  assert.deepEqual(case1, { action: "sent", payload: { processing_token: claimedProf.processing_token, provider_message_id: "msg-1" } });

  // Case 2: claimed +5566999029086, response 556699029086@s.whatsapp.net (degraded 8-digit) => sent
  const case2 = transportDecision(
    response({ key: { id: "msg-2", fromMe: true, remoteJid: "556699029086@s.whatsapp.net" } }, 200),
    claimedProf,
  );
  assert.deepEqual(case2, { action: "sent", payload: { processing_token: claimedProf.processing_token, provider_message_id: "msg-2" } });

  // Case 3: claimed +5566999029086, response 5566999029086:1@s.whatsapp.net (Baileys device JID) => sent
  const case3 = transportDecision(
    response({ key: { id: "msg-3", fromMe: true, remoteJid: "5566999029086:1@s.whatsapp.net" } }, 200),
    claimedProf,
  );
  assert.deepEqual(case3, { action: "sent", payload: { processing_token: claimedProf.processing_token, provider_message_id: "msg-3" } });

  // Also degraded device JID: 556699029086:2@s.whatsapp.net => sent
  const case3b = transportDecision(
    response({ key: { id: "msg-3b", fromMe: true, remoteJid: "556699029086:2@s.whatsapp.net" } }, 200),
    claimedProf,
  );
  assert.deepEqual(case3b, { action: "sent", payload: { processing_token: claimedProf.processing_token, provider_message_id: "msg-3b" } });

  // Case 4: remoteJid = opaque@lid, remoteJidAlt = 556699029086@s.whatsapp.net => sent
  const case4 = transportDecision(
    response({
      key: {
        id: "msg-4",
        fromMe: true,
        remoteJid: "234567890123456@lid",
        remoteJidAlt: "556699029086@s.whatsapp.net",
        addressingMode: "lid",
      },
    }, 200),
    claimedProf,
  );
  assert.deepEqual(case4, { action: "sent", payload: { processing_token: claimedProf.processing_token, provider_message_id: "msg-4" } });

  // Case 5: opaque @lid / @hosted / @hosted.lid without PN alternative => hold
  for (const opaqueJid of ["234567890123456@lid", "user@hosted", "user@hosted.lid"]) {
    const case5 = transportDecision(
      response({ key: { id: "msg-5", fromMe: true, remoteJid: opaqueJid } }, 200),
      claimedProf,
    );
    assert.equal(case5.action, "hold");
    assert.equal(case5.payload.reason, "transport_outcome_unknown");
  }

  // Case 6: different canonical recipient => hold
  const case6 = transportDecision(
    response({ key: { id: "msg-6", fromMe: true, remoteJid: "5566999029087@s.whatsapp.net" } }, 200),
    claimedProf,
  );
  assert.equal(case6.action, "hold");
  assert.equal(case6.payload.reason, "transport_outcome_unknown");

  // Case 7: two PN candidates which canonicalize to same phone => sent
  const case7 = transportDecision(
    response({
      key: {
        id: "msg-7",
        fromMe: true,
        remoteJid: "556699029086@s.whatsapp.net",
        remoteJidAlt: "5566999029086@s.whatsapp.net",
        addressingMode: "pn",
      },
    }, 200),
    claimedProf,
  );
  assert.deepEqual(case7, { action: "sent", payload: { processing_token: claimedProf.processing_token, provider_message_id: "msg-7" } });

  // Case 8: two PN candidates which canonicalize to different phones => hold
  const case8 = transportDecision(
    response({
      key: {
        id: "msg-8",
        fromMe: true,
        remoteJid: "556699029086@s.whatsapp.net",
        remoteJidAlt: "5566999029087@s.whatsapp.net",
      },
    }, 200),
    claimedProf,
  );
  assert.equal(case8.action, "hold");
  assert.equal(case8.payload.reason, "transport_outcome_unknown");

  // Case 9: malformed :: / invalid device JID => hold
  for (const badJid of [
    "5566999029086::1@s.whatsapp.net",
    "5566999029086:abc@s.whatsapp.net",
    "5566999029086:@s.whatsapp.net",
    "5566999029086@g.us",
    "status@broadcast",
    ":1@s.whatsapp.net",
  ]) {
    const case9 = transportDecision(
      response({ key: { id: "msg-9", fromMe: true, remoteJid: badJid } }, 200),
      claimedProf,
    );
    assert.equal(case9.action, "hold", `Expected hold for malformed JID: ${badJid}`);
  }

  // Case 10: fixed-line and non-BR comparisons remain exact/safe
  const claimedFixed = message("+551133334444");
  const case10a = transportDecision(
    response({ key: { id: "msg-10a", fromMe: true, remoteJid: "551133334444@s.whatsapp.net" } }, 200),
    claimedFixed,
  );
  assert.deepEqual(case10a, { action: "sent", payload: { processing_token: claimedFixed.processing_token, provider_message_id: "msg-10a" } });

  // Fixed line does not match 9-digit variant
  const case10b = transportDecision(
    response({ key: { id: "msg-10b", fromMe: true, remoteJid: "5511933334444@s.whatsapp.net" } }, 200),
    claimedFixed,
  );
  assert.equal(case10b.action, "hold");

  // Non-BR international phone
  const claimedIntl = message("+14155552671");
  const case10c = transportDecision(
    response({ key: { id: "msg-10c", fromMe: true, remoteJid: "14155552671@s.whatsapp.net" } }, 200),
    claimedIntl,
  );
  assert.deepEqual(case10c, { action: "sent", payload: { processing_token: claimedIntl.processing_token, provider_message_id: "msg-10c" } });

  // Case 11: HTTP 2xx with missing or empty key.id => hold
  for (const badId of [undefined, null, "", "   ", { id: 123 }]) {
    const case11 = transportDecision(
      response({ key: { id: badId, fromMe: true, remoteJid: "5566999029086@s.whatsapp.net" } }, 200),
      claimedProf,
    );
    assert.equal(case11.action, "hold");
  }

  // Case 12: HTTP 2xx with fromMe != true => hold
  for (const badFromMe of [false, undefined, null, "true", 1]) {
    const case12 = transportDecision(
      response({ key: { id: "msg-12", fromMe: badFromMe, remoteJid: "5566999029086@s.whatsapp.net" } }, 200),
      claimedProf,
    );
    assert.equal(case12.action, "hold");
  }

  // Case 13: existing exact authGuard 401 proven rejection behavior remains failed
  const case13 = transportDecision(
    response({ status: 401, error: "Unauthorized", response: { message: "Unauthorized" } }, 401),
    claimedProf,
  );
  assert.deepEqual(case13, { action: "failed", payload: { processing_token: claimedProf.processing_token, error_code: "transport_http_401" } });

  // Case 14: generic 400/403/404/422/429/5xx/timeouts remain hold
  for (const status of [400, 403, 404, 422, 429, 500, 502, 503, 504]) {
    const case14 = transportDecision(
      response({ error: "Generic Error" }, status),
      claimedProf,
    );
    assert.equal(case14.action, "hold");
    assert.equal(case14.payload.reason, "transport_outcome_unknown");
  }
});

test("parity test: delivery-contract, gateway-contract and @contatocerto/shared produce identical normalization", () => {
  // All 67 DDDs match between sets
  assert.equal(VALID_BRAZILIAN_DDDS.size, 67);
  assert.deepEqual([...VALID_BRAZILIAN_DDDS].sort(), [...sharedValidDDDs].sort());

  // Full matrix of test numbers
  const testNumbers = [
    // Degraded mobile with valid DDD
    "+556699029086",
    "+551198765432",
    "+552187654321",
    "+553176543210",
    "+554165432109",
    "+559999029086",
    // Canonical mobile
    "+5566999029086",
    "+5511998765432",
    // Fixed line (prefixes 2-5)
    "+556635321234",
    "+551123456789",
    "+552145678901",
    "+553156789012",
    // Invalid DDD mobile (e.g. DDD 23, 25, 26, 29)
    "+552399029086",
    "+552599029086",
    "+552699029086",
    "+552999029086",
    // International numbers
    "+14155552671",
    "+442071838750",
    "+351912345678",
  ];

  for (const num of testNumbers) {
    const deliveryResult = normalizeBrazilianMobilePhone(num);
    const sharedResult = sharedNormalizeBrazilianMobilePhone(num);
    assert.equal(
      deliveryResult,
      sharedResult,
      `Mismatch for number ${num}: delivery=${deliveryResult} vs shared=${sharedResult}`,
    );
  }
});

test("transportDecision runtime parity: exhaustive 67-DDD matrix across degraded mobile prefixes 6, 7, 8, 9", () => {
  assert.equal(VALID_BRAZILIAN_DDDS.size, 67);
  assert.equal(sharedValidDDDs.size, 67);

  const prefixes = ["6", "7", "8", "9"];
  let combinationsChecked = 0;

  for (const ddd of sharedValidDDDs) {
    for (const prefix of prefixes) {
      const degradedPhone = `+55${ddd}${prefix}1234567`;
      const canonicalPhone = sharedNormalizeBrazilianMobilePhone(degradedPhone);
      assert.equal(canonicalPhone, `+55${ddd}9${prefix}1234567`);

      const claimed = message(canonicalPhone);
      const msgId = `msg-${ddd}-${prefix}`;

      // 1. Direct standard degraded JID: 55<DDD><prefix>1234567@s.whatsapp.net
      const directResp = response({
        key: {
          id: msgId,
          fromMe: true,
          remoteJid: `55${ddd}${prefix}1234567@s.whatsapp.net`,
        },
      }, 200);
      const directDecision = transportDecision(directResp, claimed);
      assert.deepEqual(directDecision, {
        action: "sent",
        payload: {
          processing_token: claimed.processing_token,
          provider_message_id: msgId,
        },
      });

      // 2. Baileys device-qualified degraded JID: 55<DDD><prefix>1234567:1@s.whatsapp.net
      const deviceResp = response({
        key: {
          id: `${msgId}-dev`,
          fromMe: true,
          remoteJid: `55${ddd}${prefix}1234567:1@s.whatsapp.net`,
        },
      }, 200);
      const deviceDecision = transportDecision(deviceResp, claimed);
      assert.deepEqual(deviceDecision, {
        action: "sent",
        payload: {
          processing_token: claimed.processing_token,
          provider_message_id: `${msgId}-dev`,
        },
      });

      // 3. LID + remoteJidAlt degraded JID
      const lidResp = response({
        key: {
          id: `${msgId}-lid`,
          fromMe: true,
          remoteJid: "123456789012345@lid",
          remoteJidAlt: `55${ddd}${prefix}1234567@s.whatsapp.net`,
          addressingMode: "lid",
        },
      }, 200);
      const lidDecision = transportDecision(lidResp, claimed);
      assert.deepEqual(lidDecision, {
        action: "sent",
        payload: {
          processing_token: claimed.processing_token,
          provider_message_id: `${msgId}-lid`,
        },
      });

      combinationsChecked++;
    }
  }

  assert.equal(combinationsChecked, 67 * 4); // 268 combinations tested
});

test("generated Classify transport Code node runtime parity: exhaustive 67-DDD matrix across degraded mobile prefixes 6, 7, 8, 9", () => {
  const shared = JSON.parse(readFileSync(new URL("shared-delivery.json", import.meta.url), "utf8"));
  const classifyNode = shared.nodes.find((node) => node.name === "Classify transport");
  assert.ok(classifyNode, "Classify transport node must exist in shared-delivery.json");
  const jsCode = classifyNode.parameters.jsCode;

  const runClassify = (resp, msg) => {
    return runInNewContext(
      `(() => {
        ${jsCode}
      })()`,
      {
        $json: resp,
        $: (name) => {
          if (name === "Validate claim") {
            return { item: { json: { message: msg } } };
          }
          throw new Error("unexpected node ref: " + name);
        },
      },
    );
  };

  const prefixes = ["6", "7", "8", "9"];
  let combinationsChecked = 0;

  for (const ddd of sharedValidDDDs) {
    for (const prefix of prefixes) {
      const degradedPhone = `+55${ddd}${prefix}9876543`;
      const canonicalPhone = sharedNormalizeBrazilianMobilePhone(degradedPhone);
      assert.equal(canonicalPhone, `+55${ddd}9${prefix}9876543`);

      const claimed = message(canonicalPhone);
      const msgId = `code-node-${ddd}-${prefix}`;

      // 1. Direct standard degraded JID in generated code node
      const directResp = response({
        key: {
          id: msgId,
          fromMe: true,
          remoteJid: `55${ddd}${prefix}9876543@s.whatsapp.net`,
        },
      }, 200);
      const directRes = runClassify(directResp, claimed);
      assert.equal(directRes.json.outcome.action, "sent");
      assert.equal(directRes.json.outcome.payload.provider_message_id, msgId);

      // 2. Baileys device-qualified degraded JID in generated code node
      const deviceResp = response({
        key: {
          id: `${msgId}-dev`,
          fromMe: true,
          remoteJid: `55${ddd}${prefix}9876543:2@s.whatsapp.net`,
        },
      }, 200);
      const deviceRes = runClassify(deviceResp, claimed);
      assert.equal(deviceRes.json.outcome.action, "sent");
      assert.equal(deviceRes.json.outcome.payload.provider_message_id, `${msgId}-dev`);

      // 3. LID + remoteJidAlt degraded JID in generated code node
      const lidResp = response({
        key: {
          id: `${msgId}-lid`,
          fromMe: true,
          remoteJid: "987654321098765@lid",
          remoteJidAlt: `55${ddd}${prefix}9876543@s.whatsapp.net`,
          addressingMode: "lid",
        },
      }, 200);
      const lidRes = runClassify(lidResp, claimed);
      assert.equal(lidRes.json.outcome.action, "sent");
      assert.equal(lidRes.json.outcome.payload.provider_message_id, `${msgId}-lid`);

      combinationsChecked++;
    }
  }

  assert.equal(combinationsChecked, 67 * 4);
});

test("transportDecision and generated Classify transport node preserve safety on invalid DDDs, fixed lines, and non-BR numbers", () => {
  const shared = JSON.parse(readFileSync(new URL("shared-delivery.json", import.meta.url), "utf8"));
  const classifyNode = shared.nodes.find((node) => node.name === "Classify transport");
  assert.ok(classifyNode);
  const jsCode = classifyNode.parameters.jsCode;

  const runClassify = (resp, msg) => {
    return runInNewContext(
      `(() => {
        ${jsCode}
      })()`,
      {
        $json: resp,
        $: (name) => {
          if (name === "Validate claim") {
            return { item: { json: { message: msg } } };
          }
          throw new Error("unexpected node ref: " + name);
        },
      },
    );
  };

  // 1. Invalid Brazilian DDDs: no 9th-digit equivalence must be created
  const invalidDDDs = ["00", "20", "23", "25", "26", "29", "36", "39", "40", "52", "56", "57", "58", "59", "72", "76", "78", "90"];
  for (const invalidDdd of invalidDDDs) {
    assert.equal(VALID_BRAZILIAN_DDDS.has(invalidDdd), false);
    assert.equal(sharedValidDDDs.has(invalidDdd), false);

    // Mismatched 8 vs 9 on invalid DDD must HOLD (no false equivalence)
    const claimedWithNine = message(`+55${invalidDdd}991234567`);
    const respEight = response({
      key: { id: `inv-${invalidDdd}`, fromMe: true, remoteJid: `55${invalidDdd}91234567@s.whatsapp.net` },
    }, 200);
    assert.equal(transportDecision(respEight, claimedWithNine).action, "hold");
    assert.equal(runClassify(respEight, claimedWithNine).json.outcome.action, "hold");

    // Exact match on invalid DDD without mutation passes
    const claimedExact = message(`+55${invalidDdd}91234567`);
    assert.equal(transportDecision(respEight, claimedExact).action, "sent");
    assert.equal(runClassify(respEight, claimedExact).json.outcome.action, "sent");
  }

  // 2. Fixed lines (prefixes 2, 3, 4, 5): no 9th digit inserted
  const sampleValidDDDs = ["11", "21", "31", "41", "51", "61", "71", "81", "91", "66"];
  const fixedPrefixes = ["2", "3", "4", "5"];
  for (const ddd of sampleValidDDDs) {
    for (const prefix of fixedPrefixes) {
      // If claimed was incorrectly formatted with an inserted 9 (+55<DDD>9<prefix>...), it must HOLD against real fixed line
      const claimedFakeNine = message(`+55${ddd}9${prefix}1234567`);
      const respFixed = response({
        key: { id: `fix-${ddd}-${prefix}`, fromMe: true, remoteJid: `55${ddd}${prefix}1234567@s.whatsapp.net` },
      }, 200);
      assert.equal(transportDecision(respFixed, claimedFakeNine).action, "hold");
      assert.equal(runClassify(respFixed, claimedFakeNine).json.outcome.action, "hold");

      // Exact fixed line claimed vs response succeeds
      const claimedFixed = message(`+55${ddd}${prefix}1234567`);
      assert.equal(transportDecision(respFixed, claimedFixed).action, "sent");
      assert.equal(runClassify(respFixed, claimedFixed).json.outcome.action, "sent");
    }
  }

  // 3. Non-BR numbers (international): exact matching only
  const intlNumbers = [
    { claimed: "+14155552671", jid: "14155552671@s.whatsapp.net" },
    { claimed: "+442071838750", jid: "442071838750@s.whatsapp.net" },
    { claimed: "+351912345678", jid: "351912345678@s.whatsapp.net" },
  ];
  for (const { claimed: intlClaimed, jid: intlJid } of intlNumbers) {
    const claimedIntl = message(intlClaimed);
    const respIntl = response({ key: { id: "intl-1", fromMe: true, remoteJid: intlJid } }, 200);
    assert.equal(transportDecision(respIntl, claimedIntl).action, "sent");
    assert.equal(runClassify(respIntl, claimedIntl).json.outcome.action, "sent");

    // Mismatched international must HOLD
    const respIntlMismatch = response({ key: { id: "intl-2", fromMe: true, remoteJid: "14155559999@s.whatsapp.net" } }, 200);
    assert.equal(transportDecision(respIntlMismatch, claimedIntl).action, "hold");
    assert.equal(runClassify(respIntlMismatch, claimedIntl).json.outcome.action, "hold");
  }
});

test("a lost sent confirmation never triggers another transport call or failure", () => {
  const item = message();
  const sent = { action: "sent", payload: { processing_token: item.processing_token, provider_message_id: "accepted" } };
  const decision = confirmationDecision(response({}, 503), item, sent);
  assert.equal(decision.action, "hold");
  assert.equal(decision.payload.reason, "confirmation_pending");
  assert.deepEqual(confirmationDecision(response({ id: item.id, status: "sent" }), item, sent), {
    action: "complete", id: item.id, status: "sent", needs_reconciliation: false,
  });
  assert.equal(confirmationDecision(response({ id: randomUUID(), status: "sent" }), item, sent).action, "hold");
});

test("text normalization handles quotes, newlines, emoji and quoted replies without JSON interpolation", () => {
  const body = { instance: "pilot", event: "messages.upsert", data: { key: { fromMe: false, remoteJid: "5566991234567@s.whatsapp.net", id: "inbound-1" }, message: { conversation: "a pia \"vazou\"\n\\cozinha 😊" } } };
  const normalized = normalizeEvolutionText(body, "pilot", "evolution");
  assert.equal(JSON.parse(JSON.stringify(normalized)).raw_text, body.data.message.conversation);
  body.data.message = { extendedTextMessage: { text: "quero a Ana", contextInfo: { quotedMessage: { conversation: "texto citado" } } } };
  assert.equal(normalizeEvolutionText(body, "pilot", "evolution").raw_text, "quero a Ana");
  assert.throws(() => normalizeEvolutionText(body, "another", "evolution"), /instance_not_allowed/u);
  body.data.key.fromMe = true;
  assert.deepEqual(normalizeEvolutionText(body, "pilot", "evolution"), { ignored: true });
  body.data.key.fromMe = false;
  body.data.key.remoteJid = "group@g.us";
  assert.deepEqual(normalizeEvolutionText(body, "pilot", "evolution"), { ignored: true });
});

test("transportDecision normalizes official Meta Cloud API response formats and enforces recipient checks", () => {
  const claimed = message("+5566999029086");

  // Valid Cloud response with matching contacts wa_id
  const cloud1 = transportDecision(
    response({
      messaging_product: "whatsapp",
      contacts: [{ input: "5566999029086", wa_id: "5566999029086" }],
      messages: [{ id: "wamid.HBgNNTU2Njk5OTAyOTA4NlUCMRIA" }],
    }, 200),
    claimed,
  );
  assert.deepEqual(cloud1, {
    action: "sent",
    payload: {
      processing_token: claimed.processing_token,
      provider_message_id: "wamid.HBgNNTU2Njk5OTAyOTA4NlUCMRIA",
    },
  });

  // Valid Cloud response with degraded 8-digit in contacts
  const cloudDegraded = transportDecision(
    response({
      messaging_product: "whatsapp",
      contacts: [{ input: "556699029086", wa_id: "556699029086" }],
      messages: [{ id: "wamid.HBgNNTU2Njk5MDI5MDg2UCMRIA" }],
    }, 200),
    claimed,
  );
  assert.deepEqual(cloudDegraded, {
    action: "sent",
    payload: {
      processing_token: claimed.processing_token,
      provider_message_id: "wamid.HBgNNTU2Njk5MDI5MDg2UCMRIA",
    },
  });

  // Cloud response with recipient mismatch -> hold
  const cloudMismatch = transportDecision(
    response({
      messaging_product: "whatsapp",
      contacts: [{ input: "5566999029087", wa_id: "5566999029087" }],
      messages: [{ id: "wamid.HBgNNTU2Njk5OTAyOTA4N1UCMRIA" }],
    }, 200),
    claimed,
  );
  assert.equal(cloudMismatch.action, "hold");

  // Cloud response without contacts (messages array only) -> sent if message id valid
  const cloudNoContacts = transportDecision(
    response({
      messages: [{ id: "wamid.HBgNNTU2Njk5OTAyOTA4NlUCMRIA" }],
    }, 200),
    claimed,
  );
  assert.deepEqual(cloudNoContacts, {
    action: "sent",
    payload: {
      processing_token: claimed.processing_token,
      provider_message_id: "wamid.HBgNNTU2Njk5OTAyOTA4NlUCMRIA",
    },
  });

  // Empty messages array or empty id -> hold
  assert.equal(transportDecision(response({ messages: [] }, 200), claimed).action, "hold");
  assert.equal(transportDecision(response({ messages: [{ id: "" }] }, 200), claimed).action, "hold");
});

test("workflow exports are inactive, connected, credential-free and never retry transport", () => {
  for (const file of ["shared-delivery.json", "outbox-dispatcher.json", "inbox-recovery.json"]) {
    const raw = readFileSync(new URL(file, import.meta.url), "utf8");
    const workflow = JSON.parse(raw);
    assert.equal(workflow.active, false);
    assert.deepEqual(workflow.pinData, {});
    const names = new Set(workflow.nodes.map((node) => node.name));
    for (const [from, connection] of Object.entries(workflow.connections)) {
      assert.ok(names.has(from));
      for (const edge of connection.main.flat()) assert.ok(names.has(edge.node));
    }
    for (const node of workflow.nodes.filter((node) => node.type === "n8n-nodes-base.code")) {
      assert.doesNotThrow(() => new Function(node.parameters.jsCode));
    }
    for (const node of workflow.nodes.filter((node) => node.credentials)) {
      assert.deepEqual(Object.keys(node.credentials.httpHeaderAuth), ["name"]);
    }
    const send = workflow.nodes.find((node) => node.name === "Send Evolution");
    if (send) {
      assert.equal(send.retryOnFail, false);
      assert.equal(send.parameters.options.timeout, 15000);
      assert.match(send.parameters.jsonBody, /request\.body/u);
      assert.match(send.parameters.url, /request\.endpoint/u);
    }
  }
});

test("exported Classify transport Code node in shared-delivery.json evaluates the exact hardened contract", () => {
  const shared = JSON.parse(readFileSync(new URL("shared-delivery.json", import.meta.url), "utf8"));
  const classifyNode = shared.nodes.find((node) => node.name === "Classify transport");
  assert.ok(classifyNode);
  const jsCode = classifyNode.parameters.jsCode;

  const runClassify = (resp, msg) => {
    return runInNewContext(
      `(() => {
        ${jsCode}
      })()`,
      {
        $json: resp,
        $: (name) => {
          if (name === "Validate claim") {
            return { item: { json: { message: msg } } };
          }
          throw new Error("unexpected node ref: " + name);
        },
      },
    );
  };

  const claimed = message("+5566999029086");

  // Degraded 8-digit response in exported Code node
  const res1 = runClassify(
    response({ key: { id: "exported-1", fromMe: true, remoteJid: "556699029086@s.whatsapp.net" } }, 200),
    claimed,
  );
  assert.equal(res1.json.outcome.action, "sent");
  assert.equal(res1.json.outcome.payload.provider_message_id, "exported-1");

  // Device JID in exported Code node
  const res2 = runClassify(
    response({ key: { id: "exported-2", fromMe: true, remoteJid: "5566999029086:1@s.whatsapp.net" } }, 200),
    claimed,
  );
  assert.equal(res2.json.outcome.action, "sent");
  assert.equal(res2.json.outcome.payload.provider_message_id, "exported-2");

  // LID with remoteJidAlt in exported Code node
  const res3 = runClassify(
    response({
      key: {
        id: "exported-3",
        fromMe: true,
        remoteJid: "234567890123456@lid",
        remoteJidAlt: "556699029086@s.whatsapp.net",
        addressingMode: "lid",
      },
    }, 200),
    claimed,
  );
  assert.equal(res3.json.outcome.action, "sent");
  assert.equal(res3.json.outcome.payload.provider_message_id, "exported-3");

  // Mismatch in exported Code node
  const res4 = runClassify(
    response({ key: { id: "exported-4", fromMe: true, remoteJid: "5566999029087@s.whatsapp.net" } }, 200),
    claimed,
  );
  assert.equal(res4.json.outcome.action, "hold");

  // Opaque LID alone in exported Code node
  const res5 = runClassify(
    response({ key: { id: "exported-5", fromMe: true, remoteJid: "234567890123456@lid" } }, 200),
    claimed,
  );
  assert.equal(res5.json.outcome.action, "hold");
});

test("Inbox recovery export only processes bounded work; empty queue is normal and no transport is present", () => {
  const workflow = JSON.parse(readFileSync(new URL("inbox-recovery.json", import.meta.url), "utf8"));
  assert.equal(workflow.active, false);
  assert.ok(workflow.nodes.every(node => !/Evolution|Deliver|Send/.test(node.name)));
  const http = workflow.nodes.find(node => node.name === "Process next");
  assert.match(http.parameters.url, /\/internal\/channel\/inbound\/next\/process/);
  assert.equal(http.retryOnFail, false);
  const next = workflow.nodes.find(node => node.name === "Continue recovery").parameters.jsCode;
  const run = response => runInNewContext(`(() => { ${next} })()`, { $json: response, $: () => ({ item: { json: { count: 1, started_at: 123 } } }) });
  assert.equal(run({ statusCode: 204 }).length, 0);
  for (const status of ["processed", "retry_scheduled", "quarantined", "processing"]) assert.equal(run({ statusCode: 200, body: { status } })[0].json.count, 2);
  assert.throws(() => run({ statusCode: 500, body: { raw_text: "private" } }), /inbox_recovery_failed/);
  const budget = workflow.nodes.find(node => node.name === "Budget").parameters.jsCode;
  const runBudget = json => runInNewContext(`(() => { ${budget} })()`, { $input: { all: () => [{ json }] } });
  assert.equal(runBudget({ count: 10 }).length, 0); assert.equal(runBudget({ started_at: Date.now() - 46000 }).length, 0);
});

test("exported Code gate evaluates the same contract and dispatcher budgets are bounded", () => {
  const shared = JSON.parse(readFileSync(new URL("shared-delivery.json", import.meta.url), "utf8"));
  const gate = shared.nodes.find((node) => node.name === "Validate claim").parameters.jsCode;
  const runGate = (claim) => runInNewContext(`(() => { ${gate} })()`, { $json: claim, $env: { EVOLUTION_PROVIDER: "evolution", EVOLUTION_INSTANCE: "pilot" } });
  assert.equal(runGate(response(null, 204)).json.action, "stop");
  assert.equal(runGate(response(message())).json.action, "send");
  const dispatcher = JSON.parse(readFileSync(new URL("outbox-dispatcher.json", import.meta.url), "utf8"));
  const budget = dispatcher.nodes.find((node) => node.name === "Budget").parameters.jsCode;
  const runBudget = (items) => runInNewContext(`(() => { ${budget} })()`, { $input: { all: () => items } });
  assert.equal(runBudget([{ json: { count: 10, started_at: Date.now() } }]).length, 0);
  assert.equal(runBudget([{ json: { count: 0, started_at: Date.now() - 60000 } }]).length, 0);
  assert.equal(runBudget([{ json: {} }]).length, 1);
  assert.throws(() => runBudget([{ json: {} }, { json: {} }]), /one_budget/u);
});

const authTemplateMessage = (otp_code = "123456", template_name = "contatocerto_auth_otp_v1", language_code = "pt_BR") => ({
  id: randomUUID(),
  status: "processing",
  attempt_count: 1,
  purpose: "professional_auth_challenge",
  provider: "evolution",
  recipient_phone_e164: "+5566991234567",
  message_type: "interactive",
  text_content: "[auth template: " + template_name + "]",
  interactive_payload: {
    schema_version: 1,
    type: "template_authentication",
    template_name,
    language_code,
    otp_code,
  },
  processing_token: randomUUID(),
});

test("template_authentication claim accepted and builds accurate sendTemplate request", () => {
  const item = authTemplateMessage();
  const decision = claimDecision(response(item), "evolution");
  assert.equal(decision.action, "send");
  assert.equal(decision.message.message_type, "interactive");
  assert.equal(decision.message.interactive_payload.type, "template_authentication");
  assert.equal(decision.message.interactive_payload.template_name, "contatocerto_auth_otp_v1");
  assert.equal(decision.message.interactive_payload.language_code, "pt_BR");
  assert.equal(decision.message.interactive_payload.otp_code, "123456");

  const req = buildEvolutionSendRequest(decision.message, "contato-certo-oficial");
  assert.equal(req.endpoint, "/message/sendTemplate/contato-certo-oficial");
  assert.equal(req.body.number, "5566991234567");
  assert.equal(req.body.name, "contatocerto_auth_otp_v1");
  assert.equal(req.body.language, "pt_BR");
  assert.deepEqual(req.body.components, [
    {
      type: "body",
      parameters: [{ type: "text", text: "123456" }],
    },
    {
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: "123456" }],
    },
  ]);
});

test("template_authentication rejects malformed template name, language or OTP", () => {
  const base = authTemplateMessage();

  // Invalid template names
  assert.throws(() => claimDecision(response({ ...base, interactive_payload: { ...base.interactive_payload, template_name: "" } }), "evolution"), /claim_invalid/u);
  assert.throws(() => claimDecision(response({ ...base, interactive_payload: { ...base.interactive_payload, template_name: "Invalid-Name!" } }), "evolution"), /claim_invalid/u);
  assert.throws(() => claimDecision(response({ ...base, interactive_payload: { ...base.interactive_payload, template_name: "UPPERCASE" } }), "evolution"), /claim_invalid/u);

  // Invalid language
  assert.throws(() => claimDecision(response({ ...base, interactive_payload: { ...base.interactive_payload, language_code: "" } }), "evolution"), /claim_invalid/u);
  assert.throws(() => claimDecision(response({ ...base, interactive_payload: { ...base.interactive_payload, language_code: "pt-br" } }), "evolution"), /claim_invalid/u);
  assert.throws(() => claimDecision(response({ ...base, interactive_payload: { ...base.interactive_payload, language_code: "invalid_lang" } }), "evolution"), /claim_invalid/u);

  // Invalid OTP
  assert.throws(() => claimDecision(response({ ...base, interactive_payload: { ...base.interactive_payload, otp_code: "" } }), "evolution"), /claim_invalid/u);
  assert.throws(() => claimDecision(response({ ...base, interactive_payload: { ...base.interactive_payload, otp_code: "12345" } }), "evolution"), /claim_invalid/u);
  assert.throws(() => claimDecision(response({ ...base, interactive_payload: { ...base.interactive_payload, otp_code: "1234567" } }), "evolution"), /claim_invalid/u);
  assert.throws(() => claimDecision(response({ ...base, interactive_payload: { ...base.interactive_payload, otp_code: "abcdef" } }), "evolution"), /claim_invalid/u);

  // Wrong schema version
  assert.throws(() => claimDecision(response({ ...base, interactive_payload: { ...base.interactive_payload, schema_version: 2 } }), "evolution"), /claim_invalid/u);

  // buildEvolutionSendRequest checks
  assert.throws(() => buildEvolutionSendRequest({ ...base, interactive_payload: { ...base.interactive_payload, otp_code: "bad" } }, "pilot"), /interactive_payload_invalid/u);
});

test("purpose / template_authentication bijection mandatory matrix", () => {
  const validAuth = authTemplateMessage();

  // 1. professional_auth_challenge + text = REJECT
  assert.throws(
    () => claimDecision(response({
      ...validAuth,
      message_type: "text",
      text_content: "Seu codigo e 123456",
      interactive_payload: null,
    }), "evolution"),
    /outbox_claim_invalid/u,
  );

  // 2. professional_auth_challenge + button_group = REJECT
  assert.throws(
    () => claimDecision(response({
      ...validAuth,
      message_type: "interactive",
      interactive_payload: {
        schema_version: 1,
        type: "button_group",
        body: "Confirmar codigo",
        actions: [{ action_id: "ia_1", label: "OK" }],
      },
    }), "evolution"),
    /outbox_claim_invalid/u,
  );

  // 3. professional_auth_challenge + template_quick_reply = REJECT
  assert.throws(
    () => claimDecision(response({
      ...validAuth,
      message_type: "interactive",
      interactive_payload: {
        schema_version: 1,
        type: "template_quick_reply",
        template_name: "quick_reply_tpl",
        language_code: "pt_BR",
        body_parameters: ["param1"],
        actions: [{ action_id: "ia_1", label: "OK" }],
      },
    }), "evolution"),
    /outbox_claim_invalid/u,
  );

  // 4. professional_auth_challenge + template_authentication = ACCEPT
  const accepted = claimDecision(response(validAuth), "evolution");
  assert.equal(accepted.action, "send");
  assert.equal(accepted.message.purpose, "professional_auth_challenge");
  assert.equal(accepted.message.interactive_payload.type, "template_authentication");

  // 5. customer_reply + template_authentication = REJECT
  assert.throws(
    () => claimDecision(response({
      ...validAuth,
      purpose: "customer_reply",
    }), "evolution"),
    /outbox_claim_invalid/u,
  );

  // 6. professional_contact_notification + template_authentication = REJECT
  assert.throws(
    () => claimDecision(response({
      ...validAuth,
      purpose: "professional_contact_notification",
    }), "evolution"),
    /outbox_claim_invalid/u,
  );

  // 7. outro purpose permitido + template_authentication = REJECT
  for (const otherPurpose of ["professional_reply", "customer_contact_update", "channel_notice"]) {
    assert.throws(
      () => claimDecision(response({
        ...validAuth,
        purpose: otherPurpose,
      }), "evolution"),
      /outbox_claim_invalid/u,
    );
  }

  // 8. customer_reply normal text = comportamento anterior preservado
  const normalTextMsg = {
    id: randomUUID(),
    status: "processing",
    attempt_count: 1,
    purpose: "customer_reply",
    provider: "evolution",
    recipient_phone_e164: "+5566991234567",
    message_type: "text",
    text_content: "Ola, tudo bem?",
    processing_token: randomUUID(),
  };
  const normalTextDecision = claimDecision(response(normalTextMsg), "evolution");
  assert.equal(normalTextDecision.action, "send");
  assert.equal(normalTextDecision.message.message_type, "text");
  assert.equal(normalTextDecision.message.text_content, "Ola, tudo bem?");

  // 9. template_quick_reply legitimo existente = comportamento anterior preservado
  const legitimateQuickReply = {
    id: randomUUID(),
    status: "processing",
    attempt_count: 1,
    purpose: "professional_contact_notification",
    provider: "evolution",
    recipient_phone_e164: "+5566991234567",
    message_type: "interactive",
    text_content: "Nova oportunidade",
    interactive_payload: {
      schema_version: 1,
      type: "template_quick_reply",
      template_name: "contato_certo_nova_solicitacao_v1",
      language_code: "pt_BR",
      body_parameters: ["Pintor", "Sinop"],
      actions: [{ action_id: "ia_111111111111111111111111111111111111111111111111", label: "Aceitar" }],
    },
    processing_token: randomUUID(),
  };
  const quickReplyDecision = claimDecision(response(legitimateQuickReply), "evolution");
  assert.equal(quickReplyDecision.action, "send");
  assert.equal(quickReplyDecision.message.interactive_payload.type, "template_quick_reply");

  // Defense in depth: buildEvolutionSendRequest checks
  assert.throws(
    () => buildEvolutionSendRequest({
      ...validAuth,
      message_type: "text",
      text_content: "Seu codigo e 123456",
      interactive_payload: null,
    }, "pilot"),
    /interactive_payload_invalid/u,
  );

  assert.throws(
    () => buildEvolutionSendRequest({
      ...validAuth,
      interactive_payload: {
        schema_version: 1,
        type: "button_group",
        body: "Confirmar",
        actions: [{ action_id: "ia_1", label: "OK" }],
      },
    }, "pilot"),
    /interactive_payload_invalid/u,
  );

  assert.throws(
    () => buildEvolutionSendRequest({
      ...validAuth,
      purpose: "customer_reply",
    }, "pilot"),
    /interactive_payload_invalid/u,
  );

  const validReq = buildEvolutionSendRequest(validAuth, "pilot");
  assert.equal(validReq.endpoint, "/message/sendTemplate/pilot");
  assert.equal(validReq.body.name, "contatocerto_auth_otp_v1");
});

test("generated Validate claim Code node runtime parity for template_authentication", () => {
  const shared = JSON.parse(readFileSync(new URL("shared-delivery.json", import.meta.url), "utf8"));
  const gate = shared.nodes.find((node) => node.name === "Validate claim").parameters.jsCode;
  const runGate = (claim) => runInNewContext(`(() => { ${gate} })()`, { $json: claim, $env: { EVOLUTION_PROVIDER: "evolution", EVOLUTION_INSTANCE: "pilot" } });

  const item = authTemplateMessage();
  const outcome = runGate(response(item));
  assert.equal(outcome.json.action, "send");
  assert.equal(outcome.json.request.endpoint, "/message/sendTemplate/pilot");
  assert.equal(outcome.json.request.body.name, "contatocerto_auth_otp_v1");
  assert.equal(outcome.json.request.body.components[0].parameters[0].text, "123456");
  assert.equal(outcome.json.request.body.components[1].parameters[0].text, "123456");
  assert.equal(outcome.json.request.body.components[1].index, "0");
  assert.equal(outcome.json.request.body.components[1].sub_type, "url");

  // Rejections in generated Code node match claimDecision
  assert.throws(
    () => runGate(response({ ...item, message_type: "text", text_content: "code", interactive_payload: null })),
    /outbox_claim_invalid/u,
  );
  assert.throws(
    () => runGate(response({ ...item, purpose: "customer_reply" })),
    /outbox_claim_invalid/u,
  );
  assert.throws(
    () => runGate(response({
      ...item,
      interactive_payload: {
        schema_version: 1,
        type: "button_group",
        body: "Confirmar",
        actions: [{ action_id: "ia_1", label: "OK" }],
      },
    })),
    /outbox_claim_invalid/u,
  );
});

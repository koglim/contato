import assert from "node:assert/strict";
import test from "node:test";
import { globalConversationMessageContractSchema } from "@contatocerto/shared";
import { mapGlobalConversationCommandOutcome } from "./global-conversation-message.mapper.js";
import { presentGlobalConversationMessage } from "./global-conversation-message.presenter.js";
import type { GlobalConversationCommandOutcome } from "./global-conversation-command.types.js";

test("global command message mapping is exhaustive and valid", () => {
  const cases: Array<[GlobalConversationCommandOutcome, string]> = [
    [{ kind: "cancelled" }, "Busca cancelada. Quando quiser, envie uma nova mensagem com o serviço que precisa."],
    [{ kind: "restarted" }, "Vamos começar uma nova busca. Envie o serviço que você precisa e a cidade."],
    [{ kind: "no_active_conversation" }, "Não há uma busca em andamento para cancelar."],
    [{ kind: "help", pendingSlot: null }, "Envie o serviço que você precisa e a cidade. Por exemplo: eletricista em Sinop."],
    [{ kind: "help", pendingSlot: "location" }, "Informe a cidade onde você precisa do atendimento. Você também pode dizer “cancelar” ou “recomeçar”."],
    [{ kind: "help", pendingSlot: "service" }, "Informe o serviço que você precisa. Você também pode dizer “cancelar” ou “recomeçar”."],
    [{ kind: "help", pendingSlot: "selection" }, "Responda com o número da opção, diga “mostrar mais”, “cancelar” ou “recomeçar”."],
  ];
  for (const [outcome, message] of cases) {
    const contract = mapGlobalConversationCommandOutcome(outcome);
    assert.equal(globalConversationMessageContractSchema.safeParse(contract).success, true);
    assert.equal(presentGlobalConversationMessage(contract), message);
  }
});

test("global command message schema rejects unexpected fields", () => {
  assert.equal(globalConversationMessageContractSchema.safeParse({ kind: "cancelled", conversation_id: "private" }).success, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { selectionMessageContractSchema } from "@contatocerto/shared";
import { mapSelectionCommandOutcome } from "./selection-message.mapper.js";
import { presentSelectionMessage } from "./selection-message.presenter.js";
import type { SelectionCommandOutcome } from "../selection-command/selection-command.types.js";

const selected: SelectionCommandOutcome = {
  kind: "selected",
  contactId: "11111111-1111-4111-8111-111111111111",
  matchId: "22222222-2222-4222-8222-222222222222",
  professionalId: "33333333-3333-4333-8333-333333333333",
  professionalDisplayName: "Ana Eletricista",
  professionalPhoneE164: "+5566999999999",
  serviceName: "Eletricista",
  selectedAt: new Date(),
  replayed: false,
};

test("selection message mapper exposes only public selection data and supports replay", () => {
  for (const replayed of [false, true]) {
    const contract = mapSelectionCommandOutcome({ ...selected, replayed });
    assert.deepEqual(contract, {
      kind: "selected",
      professional_name: "Ana Eletricista",
      service_name: "Eletricista",
      professional_phone_e164: "+5566999999999",
      replayed,
    });
    assert.equal(selectionMessageContractSchema.safeParse(contract).success, true);
    const message = presentSelectionMessage(contract);
    assert.match(message ?? "", /Escolha confirmada/u);
    assert.doesNotMatch(message ?? "", /11111111|22222222|33333333/u);
  }
});

test("selection message mapper covers command, pagination, invalid and unavailable outcomes", () => {
  const cases: Array<[SelectionCommandOutcome, string, string | null]> = [
    [{ kind: "invalid_selection", requestedPosition: 5, visibleMatchCount: 3 }, "invalid_selection", "Escolha um número de 1 a 3."],
    [{ kind: "not_command" }, "not_command", "Responda com o número da opção que você quer escolher."],
    [{ kind: "show_more_requested", hasMore: false, shownMatchCount: 3 }, "no_more_options", "Todas as opções disponíveis já foram apresentadas."],
    [{ kind: "show_more_requested", hasMore: true, shownMatchCount: 3 }, "show_more_requested", null],
    [{ kind: "global_command", command: { kind: "cancel" } }, "global_command", null],
    [{ kind: "global_command", command: { kind: "restart" } }, "global_command", null],
    [{ kind: "global_command", command: { kind: "help" } }, "global_command", null],
    [{ kind: "conversation_not_found" }, "selection_unavailable", "Essa seleção não está mais disponível. Faça uma nova busca para continuar."],
    [{ kind: "conversation_not_active" }, "selection_unavailable", "Essa seleção não está mais disponível. Faça uma nova busca para continuar."],
    [{ kind: "conversation_expired" }, "selection_unavailable", "Essa seleção não está mais disponível. Faça uma nova busca para continuar."],
    [{ kind: "conversation_customer_mismatch" }, "selection_unavailable", "Essa seleção não está mais disponível. Faça uma nova busca para continuar."],
    [{ kind: "search_request_not_selectable" }, "selection_unavailable", "Essa seleção não está mais disponível. Faça uma nova busca para continuar."],
    [{ kind: "match_not_available" }, "selection_unavailable", "Essa seleção não está mais disponível. Faça uma nova busca para continuar."],
    [{ kind: "idempotency_conflict" }, "selection_unavailable", "Essa seleção não está mais disponível. Faça uma nova busca para continuar."],
    [{ kind: "invalid_context", reason: "missing_conversation_id" }, "selection_unavailable", "Essa seleção não está mais disponível. Faça uma nova busca para continuar."],
    [{ kind: "invalid_context", reason: "missing_customer_id" }, "selection_unavailable", "Essa seleção não está mais disponível. Faça uma nova busca para continuar."],
    [{ kind: "invalid_context", reason: "missing_search_request_id" }, "selection_unavailable", "Essa seleção não está mais disponível. Faça uma nova busca para continuar."],
    [{ kind: "invalid_context", reason: "not_awaiting_selection" }, "selection_unavailable", "Essa seleção não está mais disponível. Faça uma nova busca para continuar."],
  ];
  for (const [outcome, kind, message] of cases) {
    const contract = mapSelectionCommandOutcome(outcome);
    assert.equal(contract.kind, kind);
    assert.equal(selectionMessageContractSchema.safeParse(contract).success, true);
    assert.equal(presentSelectionMessage(contract), message);
  }
});

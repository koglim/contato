import type { GlobalConversationMessageContract } from "@contatocerto/shared";

export function presentGlobalConversationMessage(contract: GlobalConversationMessageContract): string {
  switch (contract.kind) {
    case "cancelled":
      return "Busca cancelada. Quando quiser, envie uma nova mensagem com o serviço que precisa.";
    case "restarted":
      return "Vamos começar uma nova busca. Envie o serviço que você precisa e a cidade.";
    case "no_active_conversation":
      return "Não há uma busca em andamento para cancelar.";
    case "help":
      switch (contract.pending_slot) {
        case "location":
          return "Informe a cidade onde você precisa do atendimento. Você também pode dizer “cancelar” ou “recomeçar”.";
        case "service":
          return "Informe o serviço que você precisa. Você também pode dizer “cancelar” ou “recomeçar”.";
        case "selection":
          return "Responda com o número da opção, diga “mostrar mais”, “cancelar” ou “recomeçar”.";
        case "location_confirmation":
          return "Responda se deseja usar a localização anterior (sim/não) ou informe a nova cidade ou localização.";
        case null:
          return "Envie o serviço que você precisa e a cidade. Por exemplo: eletricista em Sinop.";
      }
  }
}

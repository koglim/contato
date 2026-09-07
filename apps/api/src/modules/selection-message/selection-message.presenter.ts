import type { SelectionMessageContract } from "@contatocerto/shared";

export function presentSelectionMessage(contract: SelectionMessageContract): string | null {
  switch (contract.kind) {
    case "selected":
      return [
        "Escolha confirmada ✅",
        [
          `*${contract.professional_name}*`,
          contract.service_name,
          `📞 ${contract.professional_phone_e164}`,
        ].join("\n"),
        "Agora você pode entrar em contato diretamente.",
      ].join("\n\n");
    case "invalid_selection":
      return contract.visible_match_count > 0
        ? `Escolha um número de 1 a ${contract.visible_match_count}.`
        : "Não há opções apresentadas para escolher no momento.";
    case "not_command":
      return "Responda com o número da opção que você quer escolher.";
    case "no_more_options":
      return "Todas as opções disponíveis já foram apresentadas.";
    case "selection_unavailable":
      return "Essa seleção não está mais disponível. Faça uma nova busca para continuar.";
    case "show_more_requested":
    case "global_command":
      return null;
    default:
      return assertNever(contract);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported selection message contract: ${String(value)}`);
}

import type { SelectionMessageContract } from "@contatocerto/shared";
import { BILATERAL_NOTICE } from "../bilateral-contact/bilateral-contact.policy.js";

export function presentSelectionMessage(contract: SelectionMessageContract): string | null {
  switch (contract.kind) {
    case "selected": {
      const ref = contract.public_code ? `\n\nRef.: ${contract.public_code}` : "";
      return [
        `Você escolheu ${contract.professional_name}. Se quiser, já pode falar com ele:`,
        `*${contract.professional_name}*\n${contract.service_name}\n📞 ${contract.professional_phone_e164}${ref}`,
      ].join("\n\n");
    }
    case "consent_required":
      return `Você escolheu ${contract.professional_name}. ${BILATERAL_NOTICE}\n\nPosso compartilhar? Responda “sim” para confirmar ou “não” para voltar às opções.`;
    case "consent_declined":
      return "Tudo bem, os telefones não foram compartilhados. Você pode escolher outra opção ou enviar “cancelar”.";
    case "invalid_selection":
      return contract.visible_match_count > 0
        ? `Escolha um número de 1 a ${contract.visible_match_count}.`
        : "Não há opções apresentadas para escolher no momento.";
    case "ambiguous_selection":
      return [
        "Encontrei mais de uma opção com esse nome:",
        contract.options.map((option) => `${option.position}. ${option.professional_name}`).join("\n"),
        "Responda com o número ou com o nome completo.",
      ].join("\n\n");
    case "not_command":
      return "Não consegui identificar qual profissional você escolheu. Responda com o número ou com o nome da opção.";
    case "no_more_options":
      return "Todas as opções disponíveis para esta busca já foram apresentadas. Escolha uma delas ou envie “recomeçar” para refinar o serviço ou a região.";
    case "selection_unavailable":
      return "Essa seleção não está mais disponível. Faça uma nova busca para continuar.";
    case "show_more_requested": {
      if (!contract.matches?.length) return null;
      const money = (cents: number | null) => cents === null ? "Preço sob consulta" : `A partir de R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
      const entries = contract.matches.map((match) => [
        `${match.position}. *${match.professional_name}*`,
        match.service_name,
        match.distance_meters === null ? null : `📍 ${match.distance_meters >= 1000 ? `${(match.distance_meters / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km` : `${match.distance_meters} m`}`,
        `💰 ${match.price_mode === "quote" ? "Sob consulta" : money(match.price_from_cents)}`,
      ].filter((value): value is string => value !== null).join("\n"));
      return ["Mais opções para você 👇", ...entries, BILATERAL_NOTICE, "Responda com o número ou com o nome do profissional que você quer escolher."].join("\n\n");
    }
    case "global_command":
      return null;
    default:
      return assertNever(contract);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported selection message contract: ${String(value)}`);
}

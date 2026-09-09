import type { MatchingSearchResponse } from "@contatocerto/shared";
import { BILATERAL_NOTICE, safeOpportunityText } from "../bilateral-contact/bilateral-contact.policy.js";
import type { MessagePresenter, SearchRouteMessageResponse } from "./message-presentation.types.js";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatDistance(distanceMeters: number) {
  if (distanceMeters < 1_000) return `${distanceMeters} m`;
  return `${(distanceMeters / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`;
}

function formatPrice(service: MatchingSearchResponse["matches"][number]["service"]) {
  const from = service.price_from_cents;
  const to = service.price_to_cents;
  const money = (cents: number) => currencyFormatter.format(cents / 100);

  if (service.price_mode === "quote") return "Sob consulta";
  if (service.price_mode === "from" && from !== null) return `A partir de ${money(from)}`;
  if (service.price_mode === "fixed" && from !== null) return money(from);
  if (service.price_mode === "range" && from !== null && to !== null) return `${money(from)} a ${money(to)}`;
  return "Preço sob consulta";
}

type CustomerSearchResult = SearchRouteMessageResponse["conversation"]["result"];
type MatchedCustomerSearchResult = Extract<CustomerSearchResult, { status: "matched" }>;

function matchingFrom(result: MatchedCustomerSearchResult): MatchingSearchResponse {
  if ("matching" in result) return result.matching;
  return result.orchestration.matching;
}

function presentMatches(matching: MatchingSearchResponse) {
  const plural = matching.matches.length === 1 ? "um profissional" : `${matching.matches.length} profissionais`;
  const title = `Encontrei ${plural} para você 👇`;
  const entries = matching.matches.map((match, index) => {
    const prefix = `${index + 1}. `;
    return [
      `${prefix}*${safeOpportunityText(match.professional.display_name, 120) || "Profissional"}*`,
      safeOpportunityText(matching.service.name, 120),
      `📍 ${formatDistance(match.distance_meters)}`,
      `💰 ${formatPrice(match.service)}`,
    ].join("\n");
  });
  return [title, ...entries, BILATERAL_NOTICE, "Responda com o número ou com o nome do profissional que você quer escolher."].join("\n\n");
}

function assertNever(value: never): never {
  throw new Error(`Unsupported customer search response status: ${String(value)}`);
}

export class DefaultMessagePresenter implements MessagePresenter {
  present(response: SearchRouteMessageResponse): string {
    const result = response.conversation.result;
    switch (result.status) {
      case "needs_location":
        return "Em qual cidade você precisa do atendimento?";
      case "needs_service":
        return "Qual serviço você precisa? Pode me contar o que aconteceu.";
      case "matched":
        return presentMatches(matchingFrom(result));
      case "no_matches":
        return "Não encontrei profissionais disponíveis para esse serviço nessa região no momento.\n\nSe quiser, você pode tentar outra região ou fazer uma nova busca.";
      default:
        return assertNever(result);
    }
  }
}

export interface CandidateInquiryFact {
  position: number;
  displayName: string;
  distanceMeters: number | null;
  priceMode: "fixed" | "range" | "from" | "quote" | null;
  priceFromCents: number | null;
  priceToCents: number | null;
  isVerified: boolean;
  availability: "now" | "schedule" | "unstated" | null;
  summary: string | null;
  serviceName: string | null;
}

export type SelectionInquiryType =
  | "details"
  | "distance"
  | "price"
  | "availability"
  | "verification"
  | "best_recommendation"
  | "address"
  | "comparison"
  | "unshown"
  | "other";

function formatDistance(meters: number | null): string {
  if (meters === null) return "distância não informada";
  if (meters >= 1000) {
    const km = (meters / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
    return `${km} km`;
  }
  return `${meters} m`;
}

function formatPrice(fact: CandidateInquiryFact): string {
  if (fact.priceMode === "quote") return "Sob consulta";
  if (fact.priceFromCents === null) return "Sob consulta";
  const from = (fact.priceFromCents / 100).toFixed(2).replace(".", ",");
  if (fact.priceMode === "fixed") return `R$ ${from}`;
  if (fact.priceMode === "range" && fact.priceToCents !== null) {
    const to = (fact.priceToCents / 100).toFixed(2).replace(".", ",");
    return `R$ ${from} a R$ ${to}`;
  }
  return `A partir de R$ ${from}`;
}

export function presentSelectionInquiry(
  type: SelectionInquiryType,
  candidates: CandidateInquiryFact[],
  targetPositions: number[] = [],
): string {
  if (type === "unshown" || candidates.length === 0) {
    return "Esse prestador não está entre as opções apresentadas para a sua busca atual.";
  }

  const targets = targetPositions.length > 0
    ? candidates.filter((c) => targetPositions.includes(c.position))
    : candidates;
  const focusedCandidates = targets.length > 0 ? targets : candidates;
  const first = focusedCandidates[0]!;

  switch (type) {
    case "address": {
      if (focusedCandidates.length === 1) {
        return `Não tenho o endereço exato do prestador. Nesta busca, ${first.displayName} atende a aproximadamente ${formatDistance(first.distanceMeters)} da sua localização.`;
      }
      return "Não tenho o endereço exato dos prestadores. Eles atendem na região informada, com distância calculada a partir da sua localização.";
    }

    case "details": {
      return focusedCandidates.map((c) => {
        const verifiedTag = c.isVerified ? " (Profissional verificado)" : "";
        const summaryStr = c.summary ? ` - ${c.summary}` : "";
        return `${c.position}. *${c.displayName}*${verifiedTag}\n📍 Distância: ${formatDistance(c.distanceMeters)}\n💰 Valor: ${formatPrice(c)}${summaryStr}`;
      }).join("\n\n") + "\n\nPara solicitar o contato, responda com a opção ou nome do prestador.";
    }

    case "distance": {
      if (candidates.length === 1 || focusedCandidates.length === 1) {
        return `${first.displayName} atende a aproximadamente ${formatDistance(first.distanceMeters)} da sua localização.`;
      }
      const sorted = [...candidates].sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
      const closest = sorted[0]!;
      const others = sorted.slice(1).map((c) => `${c.displayName} (${formatDistance(c.distanceMeters)})`).join(", ");
      return `O prestador mais próximo é *${closest.displayName}*, a aproximadamente ${formatDistance(closest.distanceMeters)} da sua localização. Demais opções: ${others}.`;
    }

    case "price": {
      if (focusedCandidates.length === 1) {
        return `O valor informado para *${first.displayName}* é ${formatPrice(first)}.`;
      }
      const priceLines = candidates.map((c) => `- *${c.displayName}*: ${formatPrice(c)}`).join("\n");
      return `Valores dos prestadores disponíveis:\n${priceLines}`;
    }

    case "availability": {
      if (focusedCandidates.length === 1 && first.availability === "now") {
        return `*${first.displayName}* indicou estar disponível para atendimento imediato.`;
      }
      return "Os detalhes de data e horário de atendimento são combinados diretamente com o prestador após a liberação do contato.";
    }

    case "verification": {
      if (focusedCandidates.length === 1) {
        return first.isVerified
          ? `*${first.displayName}* é um profissional cadastrado e verificado na plataforma.`
          : `*${first.displayName}* é um profissional cadastrado na plataforma.`;
      }
      const verifiedNames = candidates.filter((c) => c.isVerified).map((c) => c.displayName).join(", ");
      return verifiedNames
        ? `Prestadores verificados nesta busca: ${verifiedNames}.`
        : "Todos os prestadores apresentados possuem cadastro ativo na plataforma.";
    }

    case "best_recommendation":
    case "comparison":
    default: {
      const summaryList = candidates.map((c) => {
        const verifiedTag = c.isVerified ? " | Verificado" : "";
        return `${c.position}. *${c.displayName}*: ${formatDistance(c.distanceMeters)} | ${formatPrice(c)}${verifiedTag}`;
      }).join("\n");
      const sampleName = candidates[0]?.displayName.split(" ")[0] ?? "João";
      return `Confira os detalhes dos prestadores disponíveis:\n\n${summaryList}\n\nPara solicitar o contato de um prestador, responda com o nome (ex: '${sampleName}') ou com a opção desejada (ex: 'opção 1').`;
    }
  }
}

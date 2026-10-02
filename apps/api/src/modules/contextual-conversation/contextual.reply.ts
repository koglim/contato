import { safeOpportunityText } from "../bilateral-contact/bilateral-contact.policy.js";
import { validateContextualQuestion, type ContextualDecision, type ContextualReplyContext } from "./contextual.contract.js";

export const CONTEXTUAL_COST_POLICY = "Usar o ContatoCerto é gratuito para o cliente. O valor do serviço é combinado e pago diretamente ao profissional. Sua busca continua de onde parou.";
export const CONTEXTUAL_FALLBACK = "Não consegui entender sua mensagem com segurança agora. Sua busca foi preservada. Pode me dizer o que precisa ou o que quer corrigir?";
export const CONTEXTUAL_CLARIFY = "Pode esclarecer o que você quer mudar ou qual opção quer escolher?";
export const CONTEXTUAL_HYPOTHESIS_REJECTED = "Entendi. Qual serviço você precisa? Pode me contar o que aconteceu.";
export const CONTEXTUAL_SCOPE = "Posso ajudar você a encontrar e escolher profissionais de serviços na sua região. Sua busca continua salva. Qual atendimento você precisa?";
export const CONTEXTUAL_GREETING = "Olá! Me conta como posso ajudar. Qual serviço você procura para sua casa ou empresa?";
export const CONTEXTUAL_SMALL_TALK = "Estou por aqui para ajudar você a encontrar um profissional. Qual serviço está precisando?";
export const CONTEXTUAL_EXPIRED_SELECTION = "Essa lista de profissionais expirou. Envie uma nova mensagem com o serviço e a cidade para eu buscar opções atualizadas.";
export const CONTEXTUAL_RESUMABLE_SELECTION_UNAVAILABLE = "Essa opção não está mais disponível. Envie uma nova mensagem com o serviço e a cidade para eu atualizar as opções.";

// Shared by runtime and evaluation. Only the domain/controller decides what may be asked.
export function contextualQuestionContext(decision: ContextualDecision, serviceResolved: boolean, locationResolved: boolean): ContextualReplyContext | null {
  if (decision.kind !== "search" && decision.kind !== "clarify") return null;
  const { memory } = decision;
  if (memory.hypotheses.length) return { target: "service_confirmation", services: memory.hypotheses.map(item => item.name), location: memory.location?.value ?? null, reason: "ambiguous" };
  if (decision.kind !== "search") return null;
  if (!serviceResolved) return { target: "service", services: [], location: memory.location?.value ?? null, reason: memory.service ? "ambiguous" : "missing" };
  if (!locationResolved) return { target: "location", services: memory.service ? [memory.service.value] : [], location: memory.location?.value ?? null, reason: memory.location ? "ambiguous" : "missing" };
  return null;
}

export function contextualClarificationText(context: ContextualReplyContext): string {
  if (context.target === "service") return "Qual serviço você precisa? Pode me contar o que aconteceu.";
  if (context.target === "location") return context.reason === "ambiguous"
    ? "Essa localização ainda não ficou clara. Pode informar a cidade e o estado ou um bairro de referência?"
    : `Em qual cidade você precisa de ${safeOpportunityText(context.services[0] ?? "atendimento", 120)}?`;
  const confirmation = context.services.length === 1
    ? `Você precisa de ${safeOpportunityText(context.services[0], 120)} para esse problema? Pode confirmar ou explicar melhor.`
    : `Esse pedido pode envolver ${context.services.map(name => safeOpportunityText(name, 120)).join(" ou ")}. Qual desses atendimentos você precisa?`;
  return confirmation.length <= 240 ? confirmation : "Pode explicar melhor qual atendimento você precisa para esse problema?";
}

export function validatePersistedContextualQuestion(draft: string, context: ContextualReplyContext): string {
  // Deterministic fallbacks may contain catalogue numbers or multiple sentences.
  // Trust only an exact match recomputed from the current validated context; all other drafts retain the model guard.
  return draft === contextualClarificationText(context) ? draft : validateContextualQuestion({ target: context.target, question: draft }, context);
}

export function contextualCatalogText(names: string[]): string {
  return names.length ? `O catálogo inclui ${names.map(name => safeOpportunityText(name, 120)).join(" e ")}. Isso não confirma profissionais na sua região. Quer buscar esse serviço?`
    : "Não identifiquei esse serviço no catálogo atual. Pode descrever melhor o atendimento que procura?";
}

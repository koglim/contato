import {
  normalizeBrazilianMobilePhone,
} from "@contatocerto/shared";
import type { DatabaseClient } from "../../database/connection.js";
import { bilateralSnapshotSchema } from "../bilateral-contact/bilateral-contact.policy.js";
import { PostgresContactCompletionRepository } from "./contact-completion.repository.js";
import type {
  ContactCompletionRepository,
  ContactCompletionActorRole,
  ContactCompletionAction,
  ContactRow,
  ContactCompletionRow,
  ContactCompletionEventRow,
} from "./contact-completion.types.js";

export type CompletionDomainOutcome = {
  action: ContactCompletionAction | "idempotent_replay" | "clarification" | "unavailable";
  replyText: string;
  contact: ContactRow;
  actorRole: ContactCompletionActorRole;
  completion?: ContactCompletionRow | { id: string; state: ContactCompletionRow["state"] };
  event?: ContactCompletionEventRow | { id: string };
};

export interface CompletionDomainOptions {
  provider?: string;
  repository?: ContactCompletionRepository;
}

function resolveContext(
  contact: ContactRow,
  actorRole: ContactCompletionActorRole,
  options?: CompletionDomainOptions
) {
  const snapshotParse = bilateralSnapshotSchema.safeParse(contact.bilateral_snapshot);
  if (!snapshotParse.success) {
    throw new Error("Invalid contact bilateral snapshot");
  }
  const snapshot = snapshotParse.data;

  const counterpartRole: ContactCompletionActorRole =
    actorRole === "customer" ? "professional" : "customer";
  const counterpartPhone = normalizeBrazilianMobilePhone(
    actorRole === "customer" ? snapshot.professional_phone_e164 : snapshot.customer_phone_e164
  );
  const actorLabel = actorRole === "customer" ? "O cliente" : "O profissional";
  const counterpartLabel = actorRole === "customer" ? "do profissional" : "do cliente";
  const provider = options?.provider ?? "default";

  return {
    snapshot,
    counterpartRole,
    counterpartPhone,
    actorLabel,
    counterpartLabel,
    provider,
  };
}

function checkContactEligibility(
  contact: ContactRow,
  actorRole: ContactCompletionActorRole,
  commandKind: "declare" | "confirm" | "contest"
): CompletionDomainOutcome | null {
  if (contact.status === "completed") {
    const replyText =
      commandKind === "contest"
        ? "Essa solicitação já foi concluída e não pode ser contestada."
        : "Essa solicitação já foi concluída anteriormente.";
    return {
      action: "idempotent_replay",
      replyText,
      contact,
      actorRole,
    };
  }

  if (contact.status === "declined") {
    return {
      action: "unavailable",
      replyText: "Essa solicitação foi recusada e não pode ser concluída.",
      contact,
      actorRole,
    };
  }

  if (contact.status === "requested") {
    return {
      action: "unavailable",
      replyText: "Essa solicitação ainda está aguardando resposta e não pode ser concluída.",
      contact,
      actorRole,
    };
  }

  if (contact.status !== "shared" && contact.status !== "accepted") {
    return {
      action: "unavailable",
      replyText: "Essa solicitação não está disponível para conclusão.",
      contact,
      actorRole,
    };
  }

  return null;
}

export async function executeCompletionDeclaration(
  db: DatabaseClient,
  contact: ContactRow,
  actorRole: ContactCompletionActorRole,
  inboundId: string,
  options?: CompletionDomainOptions
): Promise<CompletionDomainOutcome> {
  const ineligible = checkContactEligibility(contact, actorRole, "declare");
  if (ineligible) return ineligible;

  const repo = options?.repository ?? new PostgresContactCompletionRepository();
  const ctx = resolveContext(contact, actorRole, options);

  let completion = await repo.findCompletionByContactId(db, contact.id, true);

  if (!completion) {
    completion = await repo.createCompletion(db, {
      contactId: contact.id,
      state: "pending_confirmation",
      declaredBy: actorRole,
    });

    const event = await repo.createEvent(db, {
      completionId: completion.id,
      contactId: contact.id,
      actorRole,
      action: "declared",
      inboundMessageId: inboundId,
    });

    const promptText = `${ctx.actorLabel} declarou a conclusão do serviço da solicitação ${contact.public_code}. Se o serviço foi finalizado, responda “confirmar ${contact.public_code}”. Se houver divergência, responda “contestar ${contact.public_code}”.`;
    await repo.insertOutboundNotification(db, {
      purpose:
        ctx.counterpartRole === "customer"
          ? "customer_contact_update"
          : "professional_contact_notification",
      provider: ctx.provider,
      recipientPhoneE164: ctx.counterpartPhone,
      textContent: promptText,
      businessKey: `contact:${contact.id}:completion:prompt`,
      completionEventId: event.id,
    });

    const replyText = `Solicitação de conclusão registrada para ${contact.public_code}. Aguardando confirmação ${ctx.counterpartLabel}.`;
    return {
      action: "declared",
      replyText,
      contact,
      actorRole,
      completion,
      event,
    };
  }

  if (completion.state === "pending_confirmation") {
    if (completion.declared_by === actorRole) {
      // Same-side replay
      const replyText = `Você já registrou a declaração de conclusão para ${contact.public_code}. Aguardando confirmação ${ctx.counterpartLabel}.`;
      return {
        action: "idempotent_replay",
        replyText,
        contact,
        actorRole,
        completion,
      };
    }

    // Counterpart declaration acts as confirmation
    completion = await repo.updateCompletionState(db, completion.id, {
      state: "confirmed",
      confirmedAt: new Date(),
    });
    await repo.updateContactStatus(db, contact.id, "completed");

    const event = await repo.createEvent(db, {
      completionId: completion.id,
      contactId: contact.id,
      actorRole,
      action: "confirmed",
      inboundMessageId: inboundId,
    });

    const notifText = `${ctx.actorLabel} também declarou a conclusão do serviço ${contact.public_code}. O serviço foi finalizado com sucesso!`;
    await repo.insertOutboundNotification(db, {
      purpose:
        ctx.counterpartRole === "customer"
          ? "customer_contact_update"
          : "professional_contact_notification",
      provider: ctx.provider,
      recipientPhoneE164: ctx.counterpartPhone,
      textContent: notifText,
      businessKey: `contact:${contact.id}:completion:confirmed`,
      completionEventId: event.id,
    });

    const replyText = `Conclusão do serviço ${contact.public_code} confirmada com sucesso.`;
    return {
      action: "confirmed",
      replyText,
      contact,
      actorRole,
      completion,
      event,
    };
  }

  if (completion.state === "confirmed") {
    const replyText = "Essa solicitação já foi concluída anteriormente.";
    return {
      action: "idempotent_replay",
      replyText,
      contact,
      actorRole,
      completion,
    };
  }

  if (completion.state === "contested") {
    const replyText = "Essa solicitação possui uma contestação de conclusão registrada e permanece em andamento.";
    return {
      action: "unavailable",
      replyText,
      contact,
      actorRole,
      completion,
    };
  }

  return {
    action: "unavailable",
    replyText: "Essa solicitação não está disponível para conclusão.",
    contact,
    actorRole,
  };
}

export async function executeCompletionConfirmation(
  db: DatabaseClient,
  contact: ContactRow,
  actorRole: ContactCompletionActorRole,
  inboundId: string,
  options?: CompletionDomainOptions
): Promise<CompletionDomainOutcome> {
  const ineligible = checkContactEligibility(contact, actorRole, "confirm");
  if (ineligible) return ineligible;

  const repo = options?.repository ?? new PostgresContactCompletionRepository();
  const ctx = resolveContext(contact, actorRole, options);

  let completion = await repo.findCompletionByContactId(db, contact.id, true);

  if (!completion) {
    return {
      action: "clarification",
      replyText: "Não há declaração de conclusão pendente para essa solicitação.",
      contact,
      actorRole,
    };
  }

  if (completion.state === "pending_confirmation") {
    if (completion.declared_by === actorRole) {
      const replyText = `Você é quem declarou a conclusão para ${contact.public_code}. A confirmação deve ser feita pela outra parte.`;
      return {
        action: "clarification",
        replyText,
        contact,
        actorRole,
        completion,
      };
    }

    // Valid counterpart confirmation
    completion = await repo.updateCompletionState(db, completion.id, {
      state: "confirmed",
      confirmedAt: new Date(),
    });
    await repo.updateContactStatus(db, contact.id, "completed");

    const event = await repo.createEvent(db, {
      completionId: completion.id,
      contactId: contact.id,
      actorRole,
      action: "confirmed",
      inboundMessageId: inboundId,
    });

    const notifText = `${ctx.actorLabel} confirmou a conclusão do serviço ${contact.public_code}. O serviço foi finalizado com sucesso!`;
    await repo.insertOutboundNotification(db, {
      purpose:
        ctx.counterpartRole === "customer"
          ? "customer_contact_update"
          : "professional_contact_notification",
      provider: ctx.provider,
      recipientPhoneE164: ctx.counterpartPhone,
      textContent: notifText,
      businessKey: `contact:${contact.id}:completion:confirmed`,
      completionEventId: event.id,
    });

    const replyText = `Conclusão do serviço ${contact.public_code} confirmada com sucesso.`;
    return {
      action: "confirmed",
      replyText,
      contact,
      actorRole,
      completion,
      event,
    };
  }

  if (completion.state === "confirmed") {
    const replyText = "Essa solicitação já foi concluída anteriormente.";
    return {
      action: "idempotent_replay",
      replyText,
      contact,
      actorRole,
      completion,
    };
  }

  if (completion.state === "contested") {
    const replyText = "Essa solicitação possui uma contestação de conclusão registrada e permanece em andamento.";
    return {
      action: "unavailable",
      replyText,
      contact,
      actorRole,
      completion,
    };
  }

  return {
    action: "unavailable",
    replyText: "Essa solicitação não está disponível para conclusão.",
    contact,
    actorRole,
  };
}

export async function executeCompletionContestation(
  db: DatabaseClient,
  contact: ContactRow,
  actorRole: ContactCompletionActorRole,
  inboundId: string,
  options?: CompletionDomainOptions
): Promise<CompletionDomainOutcome> {
  const ineligible = checkContactEligibility(contact, actorRole, "contest");
  if (ineligible) return ineligible;

  const repo = options?.repository ?? new PostgresContactCompletionRepository();
  const ctx = resolveContext(contact, actorRole, options);

  let completion = await repo.findCompletionByContactId(db, contact.id, true);

  if (!completion) {
    return {
      action: "clarification",
      replyText: "Não há declaração de conclusão pendente para contestar.",
      contact,
      actorRole,
    };
  }

  if (completion.state === "pending_confirmation") {
    if (completion.declared_by === actorRole) {
      const replyText = `Você registrou a declaração de conclusão para ${contact.public_code}. A contestação só pode ser feita pela outra parte.`;
      return {
        action: "clarification",
        replyText,
        contact,
        actorRole,
        completion,
      };
    }

    // Valid counterpart contestation
    completion = await repo.updateCompletionState(db, completion.id, {
      state: "contested",
      contestedAt: new Date(),
    });

    const event = await repo.createEvent(db, {
      completionId: completion.id,
      contactId: contact.id,
      actorRole,
      action: "contested",
      inboundMessageId: inboundId,
    });

    const notifText = `${ctx.actorLabel} contestou a declaração de conclusão do serviço ${contact.public_code}. O serviço permanece ativo em andamento.`;
    await repo.insertOutboundNotification(db, {
      purpose:
        ctx.counterpartRole === "customer"
          ? "customer_contact_update"
          : "professional_contact_notification",
      provider: ctx.provider,
      recipientPhoneE164: ctx.counterpartPhone,
      textContent: notifText,
      businessKey: `contact:${contact.id}:completion:contested`,
      completionEventId: event.id,
    });

    const replyText = `A contestação da conclusão do serviço ${contact.public_code} foi registrada. O serviço permanece em andamento.`;
    return {
      action: "contested",
      replyText,
      contact,
      actorRole,
      completion,
      event,
    };
  }

  if (completion.state === "confirmed") {
    const replyText = "Essa solicitação já foi concluída e não pode ser contestada.";
    return {
      action: "unavailable",
      replyText,
      contact,
      actorRole,
      completion,
    };
  }

  if (completion.state === "contested") {
    const replyText = "Essa solicitação possui uma contestação de conclusão registrada e permanece em andamento.";
    return {
      action: "unavailable",
      replyText,
      contact,
      actorRole,
      completion,
    };
  }

  return {
    action: "unavailable",
    replyText: "Essa solicitação não está disponível para conclusão.",
    contact,
    actorRole,
  };
}

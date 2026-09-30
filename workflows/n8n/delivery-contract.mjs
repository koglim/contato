// Pure functions embedded unchanged in n8n Code nodes by build-workflows.mjs.
// No credentials, HTTP calls or model calls belong in this module.

export const VALID_BRAZILIAN_DDDS = new Set([
  "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "21", "22", "24", "27", "28",
  "31", "32", "33", "34", "35", "37", "38",
  "41", "42", "43", "44", "45", "46", "47", "48", "49",
  "51", "53", "54", "55",
  "61", "62", "63", "64", "65", "66", "67", "68", "69",
  "71", "73", "74", "75", "77", "79",
  "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "91", "92", "93", "94", "95", "96", "97", "98", "99",
]);

export function normalizeBrazilianMobilePhone(phone) {
  if (typeof phone !== "string") return phone;
  const match = /^\+55([1-9]{2})([6-9]\d{7})$/.exec(phone);
  if (match && VALID_BRAZILIAN_DDDS.has(match[1])) {
    return `+55${match[1]}9${match[2]}`;
  }
  return phone;
}

export function extractPhoneFromJid(jid) {
  if (typeof jid !== "string") return null;
  const match = /^([1-9]\d{7,14})(?::(\d+))?@s\.whatsapp\.net$/u.exec(jid);
  if (!match) return null;
  return normalizeBrazilianMobilePhone(`+${match[1]}`);
}

export function isOpaqueJid(jid) {
  if (typeof jid !== "string") return false;
  return /^[a-zA-Z0-9_.-]+(?::\d+)?@(lid|hosted|hosted\.lid)$/u.test(jid);
}

export function httpResponse(response) {
  if (typeof response?.body !== "string") return response;
  if (!response.body.trim()) return { ...response, body: null };
  try { return { ...response, body: JSON.parse(response.body) }; }
  catch { return { ...response, body: null }; }
}

export function claimDecision(response, expectedProvider) {
  response = httpResponse(response);
  if (response?.statusCode === 204) return { action: "stop", reason: "empty" };
  if (response?.statusCode === 409) return { action: "stop", reason: "busy" };
  if (response?.statusCode !== 200) throw new Error("outbox_claim_unavailable");
  const message = response.body;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
  const purposes = ["customer_reply", "professional_contact_notification", "professional_reply", "customer_contact_update", "channel_notice", "professional_auth_challenge"];
  if (!uuid.test(message?.id ?? "") || !purposes.includes(message?.purpose)
    || !Number.isInteger(message?.attempt_count) || message.attempt_count < 0) throw new Error("outbox_claim_invalid");
  if (message.status === "sent") return { action: "stop", reason: "sent" };
  if (message.status !== "processing" || !uuid.test(message.processing_token ?? "")
    || !/^[a-z][a-z0-9_-]{0,62}$/u.test(expectedProvider ?? "") || message.provider !== expectedProvider
    || !/^\+[1-9][0-9]{7,14}$/u.test(message.recipient_phone_e164 ?? "")
    || message.message_type !== "text" || typeof message.text_content !== "string"
    || !message.text_content.trim() || message.text_content.length > 2000) throw new Error("outbox_claim_invalid");
  return { action: "send", message: {
    id: message.id, purpose: message.purpose, provider: message.provider,
    recipient_phone_e164: message.recipient_phone_e164, text_content: message.text_content,
    processing_token: message.processing_token,
  } };
}

export function transportDecision(response, message) {
  const VALID_BRAZILIAN_DDDS = new Set([
    "11", "12", "13", "14", "15", "16", "17", "18", "19",
    "21", "22", "24", "27", "28",
    "31", "32", "33", "34", "35", "37", "38",
    "41", "42", "43", "44", "45", "46", "47", "48", "49",
    "51", "53", "54", "55",
    "61", "62", "63", "64", "65", "66", "67", "68", "69",
    "71", "73", "74", "75", "77", "79",
    "81", "82", "83", "84", "85", "86", "87", "88", "89",
    "91", "92", "93", "94", "95", "96", "97", "98", "99",
  ]);

  const normalizeBr = (phone) => {
    if (typeof phone !== "string") return phone;
    const match = /^\+55([1-9]{2})([6-9]\d{7})$/.exec(phone);
    if (match && VALID_BRAZILIAN_DDDS.has(match[1])) {
      return `+55${match[1]}9${match[2]}`;
    }
    return phone;
  };

  const extractPhone = (jid) => {
    if (typeof jid !== "string") return null;
    const match = /^([1-9]\d{7,14})(?::(\d+))?@s\.whatsapp\.net$/u.exec(jid);
    if (!match) return null;
    return normalizeBr(`+${match[1]}`);
  };

  const isOpaque = (jid) => {
    if (typeof jid !== "string") return false;
    return /^[a-zA-Z0-9_.-]+(?::\d+)?@(lid|hosted|hosted\.lid)$/u.test(jid);
  };

  response = httpResponse(response);
  const code = response?.statusCode;
  const key = response?.body?.key;
  if (Number.isInteger(code) && code >= 200 && code < 300) {
    if (key?.fromMe === true && typeof key?.id === "string" && key.id.trim() && key.id.length <= 255) {
      if (key.addressingMode === undefined || (typeof key.addressingMode === "string" && ["lid", "pn"].includes(key.addressingMode))) {
        const primaryPhone = extractPhone(key.remoteJid);
        const primaryOpaque = isOpaque(key.remoteJid);
        if (primaryPhone || primaryOpaque) {
          let altPhone = null;
          let altOpaque = false;
          let altValid = true;
          if (key.remoteJidAlt !== undefined && key.remoteJidAlt !== null && key.remoteJidAlt !== "") {
            if (typeof key.remoteJidAlt === "string") {
              altPhone = extractPhone(key.remoteJidAlt);
              altOpaque = isOpaque(key.remoteJidAlt);
              if (!altPhone && !altOpaque) altValid = false;
            } else {
              altValid = false;
            }
          }
          if (altValid) {
            let resolvedPhone = null;
            if (primaryPhone && altPhone) {
              if (primaryPhone === altPhone) {
                resolvedPhone = primaryPhone;
              }
            } else if (primaryPhone) {
              resolvedPhone = primaryPhone;
            } else if (primaryOpaque && altPhone) {
              resolvedPhone = altPhone;
            }

            const claimedCanonical = normalizeBr(message?.recipient_phone_e164);
            if (resolvedPhone && claimedCanonical && resolvedPhone === claimedCanonical) {
              return { action: "sent", payload: { processing_token: message.processing_token, provider_message_id: key.id } };
            }
          }
        }
      }
    }
  }
  // Evolution 2.3.7 wraps even post-send exceptions in BadRequestException (400).
  // Status alone (including a proxy's 429) is NOT proof that sending never ran.
  // This exact authGuard rejection occurs before the send controller. Everything
  // else is retained, pending provider reconciliation rather than a blind retry.
  if (code === 401 && response.body?.status === 401 && response.body?.error === "Unauthorized"
    && response.body?.response?.message === "Unauthorized") {
    return { action: "failed", payload: { processing_token: message.processing_token, error_code: `transport_http_${code}` } };
  }
  return { action: "hold", payload: { processing_token: message.processing_token, reason: "transport_outcome_unknown" } };
}

export function confirmationDecision(response, message, outcome) {
  response = httpResponse(response);
  const expected = outcome.action === "sent" ? ["sent"] : outcome.action === "failed" ? ["pending", "failed"] : ["processing"];
  const body = response?.body;
  if (response?.statusCode === 200 && body?.id === message.id && expected.includes(body.status)
    && (outcome.action !== "hold" || body.delivery_status === "reconciliation_required")) {
    return { action: "complete", id: message.id, status: body.status, needs_reconciliation: outcome.action === "hold" };
  }
  if (outcome.action === "sent") return {
    action: "hold", id: message.id,
    provider_message_id: outcome.payload.provider_message_id,
    payload: { processing_token: message.processing_token, reason: "confirmation_pending", provider_message_id: outcome.payload.provider_message_id },
  };
  throw new Error("outbox_confirmation_unavailable");
}

export function normalizeEvolutionText(body, expectedInstance, provider) {
  if (!expectedInstance || body?.instance !== expectedInstance) throw new Error("channel_instance_not_allowed");
  if (body.event !== "messages.upsert") return { ignored: true };
  const data = body.data;
  if (data?.key?.fromMe === true) return { ignored: true };
  const jid = data?.key?.remoteJid;
  if (typeof jid !== "string" || !/^\d{8,15}@s\.whatsapp\.net$/u.test(jid)) return { ignored: true };
  const text = data.message?.conversation ?? data.message?.extendedTextMessage?.text;
  if (typeof text !== "string" || !text.trim()) return { ignored: true, reason: "unsupported_message" };
  if (text.length > 2000 || typeof data.key.id !== "string" || !data.key.id || data.key.id.length > 255
    || !/^[a-z][a-z0-9_-]{0,62}$/u.test(provider ?? "")) throw new Error("channel_input_invalid");
  return { provider, provider_message_id: data.key.id, phone_e164: `+${jid.split("@")[0]}`,
    raw_text: text, country_code: "BR", limit: 3 };
}

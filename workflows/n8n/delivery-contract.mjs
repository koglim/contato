// Pure functions embedded unchanged in n8n Code nodes by build-workflows.mjs.
// No credentials, HTTP calls or model calls belong in this module.
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
  const purposes = ["customer_reply", "professional_contact_notification", "professional_reply", "customer_contact_update", "channel_notice"];
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
  response = httpResponse(response);
  const code = response?.statusCode;
  const key = response?.body?.key;
  if (Number.isInteger(code) && code >= 200 && code < 300
    && key?.fromMe === true && typeof key.id === "string" && key.id.trim()
    && key.id.length <= 255 && key.remoteJid === `${message.recipient_phone_e164.slice(1)}@s.whatsapp.net`) {
    return { action: "sent", payload: { processing_token: message.processing_token, provider_message_id: key.id } };
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

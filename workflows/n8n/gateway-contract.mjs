import { httpResponse } from "./delivery-contract.mjs";
import { Buffer } from "node:buffer";
// Embedded verbatim in Code nodes. jwtPayload is supplied by the native Webhook
// AFTER jwtAuth verification; it must never be taken from request.body.
export function normalizeGatewayEvent(input, config, now = Math.floor(Date.now() / 1000)) {
  const reject = (reason, http_status = 422) => ({ action: "reject", reason, http_status });
  const ignore = reason => ({ action: "ignore", reason, http_status: 200 });
  const jwt = input?.jwtPayload;
  if (jwt?.app !== "evolution" || jwt.action !== "webhook" || !Number.isInteger(jwt.iat)
    || !Number.isInteger(jwt.exp) || jwt.exp <= now || jwt.iat > now + 30
    || jwt.exp - jwt.iat > 600 || jwt.exp <= jwt.iat) return reject("webhook_auth_invalid", 403);
  if (!/^application\/json(?:\s*;|$)/iu.test(input?.headers?.["content-type"] ?? "")) return reject("webhook_content_type", 415);
  const body = input.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return reject("webhook_envelope_invalid");
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > 5 * 1024 * 1024) return reject("webhook_body_too_large", 413);
  if (!config.instance || body.instance !== config.instance) return reject("webhook_instance_invalid", 403);
  if (!config.origin || body.server_url !== config.origin) return reject("webhook_origin_invalid", 403);
  if (!/^[a-z][a-z0-9_-]{0,62}$/u.test(config.provider ?? "")) return reject("webhook_provider_unconfigured", 503);
  if (body.event !== "messages.upsert") return ignore("unsupported_event");
  const key = body.data?.key;
  if (key?.fromMe === true) return ignore("own_message");
  if (key?.fromMe !== false) return reject("webhook_key_invalid");
  if (typeof key.remoteJid !== "string") return reject("webhook_phone_invalid");
  if (key.remoteJid.endsWith("@g.us") || key.remoteJid.endsWith("@broadcast")) return ignore("unsupported_recipient");
  const phoneJid = /^[1-9][0-9]{7,14}@s\.whatsapp\.net$/u;
  const primaryPhone = phoneJid.test(key.remoteJid);
  const altPhone = phoneJid.test(key.remoteJidAlt ?? "");
  if (primaryPhone && altPhone && key.remoteJid !== key.remoteJidAlt) return reject("webhook_phone_conflict");
  const jid = primaryPhone ? key.remoteJid : /^\d+@lid$/u.test(key.remoteJid) && altPhone ? key.remoteJidAlt : null;
  if (!jid) return reject("webhook_phone_invalid");
  if (typeof key.id !== "string" || !/^[A-Za-z0-9_-]+$/u.test(key.id)
    || `${config.instance}:${key.id}`.length > 255) return reject("webhook_id_invalid");
  const inbound = { provider: config.provider, provider_message_id: `${config.instance}:${key.id}`,
    phone_e164: `+${jid.split("@")[0]}`, country_code: "BR", limit: 3 };
  const message = body.data.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return reject("webhook_message_invalid");
  const notice = (reason, text) => ({ action: "notice", inbound, reason, text, http_status: 200 });
  if (message.audioMessage) {
    const audio = message.audioMessage;
    if (!Number.isFinite(audio.seconds) || audio.seconds <= 0 || audio.seconds > 120) return notice("audio_duration_invalid", "Envie um áudio de até 2 minutos ou escreva o que você precisa.");
    const base64 = message.base64;
    const mime = typeof audio.mimetype === "string" ? audio.mimetype.split(";")[0].trim() : "";
    const extensions = { "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/wav": "wav", "audio/webm": "webm" };
    if (!extensions[mime] || typeof base64 !== "string" || !base64.length || base64.length > 4 * 1024 * 1024
      || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(base64)) {
      return notice("audio_content_invalid", "Não consegui ler esse áudio. Pode escrever o pedido ou enviar um novo áudio de até 2 minutos?");
    }
    return { action: "audio", inbound, audio_base64: base64, mime_type: mime, file_name: `audio.${extensions[mime]}` };
  }
  const text = message.conversation ?? message.extendedTextMessage?.text;
  if (text === undefined) return ignore("unsupported_message");
  if (typeof text !== "string" || !text.trim() || text.trim().length > 500) return reject("webhook_text_invalid");
  return { action: "inbox", inbound: { ...inbound, raw_text: text.trim() } };
}

export function transcriptionDecision(response, context, finalAttempt) {
  response = httpResponse(response);
  const text = response?.body?.text;
  if (response?.statusCode === 200 && typeof text === "string" && text.trim().length > 0 && text.trim().length <= 500) {
    return { action: "inbox", inbound: { ...context.inbound, raw_text: text.trim() } };
  }
  if (!finalAttempt) return { action: "fallback" };
  return { action: "notice", inbound: context.inbound, http_status: 200, reason: "transcription_unavailable",
    text: "Não consegui entender esse áudio. Pode escrever o pedido ou enviar um novo áudio de até 2 minutos?" };
}

export function inboxDecision(response) {
  response = httpResponse(response);
  const status = response?.statusCode;
  const body = response?.body;
  if (status === 204) return { action: "stop", http_status: 200, reason: "no_outbox" };
  if (status === 200 && /^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(body?.outbound?.id ?? "")
    && ["pending", "processing", "sent", "failed"].includes(body.outbound.status)) {
    return { action: "claim", id: body.outbound.id, http_status: 200 };
  }
  if (status === 409 && ["channel_message_processing", "conversation_processing", "selection_show_more_pending"].includes(body?.error)) {
    // These records are already durable; the recovery consumer resumes them.
    return { action: "stop", http_status: 200, reason: "inbox_deferred" };
  }
  if (status === 409 && body?.error === "channel_message_payload_conflict") return { action: "stop", http_status: 409, reason: "payload_conflict" };
  return { action: "stop", http_status: [400,401,403,422,429].includes(status) ? status : 502, reason: "inbox_unavailable" };
}

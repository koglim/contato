import { httpResponse } from "./delivery-contract.mjs";
import { Buffer } from "node:buffer";

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

// Embedded verbatim in Code nodes. jwtPayload is supplied by the native Webhook
// AFTER jwtAuth verification; it must never be taken from request.body.
export function normalizeGatewayEvent(input, config, now = Math.floor(Date.now() / 1000)) {
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

  if (key.addressingMode !== undefined) {
    if (typeof key.addressingMode !== "string" || !["lid", "pn"].includes(key.addressingMode)) {
      return reject("webhook_phone_invalid");
    }
  }

  const primaryPhone = extractPhone(key.remoteJid);
  const primaryOpaque = isOpaque(key.remoteJid);
  if (!primaryPhone && !primaryOpaque) return reject("webhook_phone_invalid");

  let altPhone = null;
  let altOpaque = false;
  if (key.remoteJidAlt !== undefined && key.remoteJidAlt !== null && key.remoteJidAlt !== "") {
    if (typeof key.remoteJidAlt !== "string") return reject("webhook_phone_invalid");
    altPhone = extractPhone(key.remoteJidAlt);
    altOpaque = isOpaque(key.remoteJidAlt);
    if (!altPhone && !altOpaque) return reject("webhook_phone_invalid");
  }

  let phone_e164 = null;
  if (primaryPhone && altPhone) {
    if (primaryPhone !== altPhone) return reject("webhook_phone_conflict");
    phone_e164 = primaryPhone;
  } else if (primaryPhone) {
    phone_e164 = primaryPhone;
  } else if (primaryOpaque && altPhone) {
    phone_e164 = altPhone;
  } else {
    return reject("webhook_phone_invalid");
  }

  if (typeof key.id !== "string" || !/^[A-Za-z0-9_-]+$/u.test(key.id)
    || `${config.instance}:${key.id}`.length > 255) return reject("webhook_id_invalid");

  const inbound = { provider: config.provider, provider_message_id: `${config.instance}:${key.id}`,
    phone_e164, country_code: "BR", limit: 3 };
  const message = body.data.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return reject("webhook_message_invalid");
  if (message.audioMessage) {
    const audio = message.audioMessage;
    // The API classifies, fingerprints and persists every audio event BEFORE ACK.
    // No notice text and no transcription decision belongs to this gateway.
    return { action: "audio", inbound, media: { ...inbound,
      audio_base64: typeof message.base64 === 'string' ? message.base64 : '',
      mime_type: typeof audio.mimetype === 'string' ? audio.mimetype.slice(0,100) : '',
      duration_seconds: Number.isFinite(audio.seconds) && audio.seconds>=0 ? audio.seconds : null } };
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
    return { action: "persist", id:context.id, payload:{processing_token:context.processing_token,media_hash:context.media_hash,
      result:{status:'transcribed',provider:finalAttempt?'openai':'groq',text:text.trim()}} };
  }
  if (!finalAttempt) return { action: "fallback" };
  return { action: "persist", id:context.id, payload:{processing_token:context.processing_token,media_hash:context.media_hash,
    result:{status:'failed',error_code:'transcription_unavailable'}} };
}

export function mediaAdmissionDecision(response) {
  response=httpResponse(response);
  if (response?.statusCode===200 && /^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(response.body?.id??'')
    && ['pending','processing','completed','failed','quarantined'].includes(response.body?.status) && typeof response.body?.duplicate==='boolean')
    return {http_status:200,reason:'media_persisted'};
  return {http_status:response?.statusCode===409?409:503,reason:'media_not_acknowledged'};
}

export function mediaClaimDecision(response) {
  response=httpResponse(response);
  if (response?.statusCode===204) return [];
  const m=response?.body, uuid=/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu;
  const ext={'audio/ogg':'ogg','audio/mpeg':'mp3','audio/mp4':'m4a','audio/wav':'wav','audio/webm':'webm'};
  if (response?.statusCode!==200 || !uuid.test(m?.id??'') || !uuid.test(m?.processing_token??'')
    || !/^[a-f0-9]{64}$/u.test(m?.media_hash??'') || !ext[m?.mime_type] || typeof m?.audio_base64!=='string'
    || !m.audio_base64.length || m.audio_base64.length>4*1024*1024) throw new Error('media_claim_invalid');
  return [{json:{...m,file_name:`audio.${ext[m.mime_type]}`}}];
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

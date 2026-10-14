import { httpResponse } from "./delivery-contract.mjs";
import { Buffer } from "node:buffer";

export {
  VALID_BRAZILIAN_DDDS,
  normalizeBrazilianMobilePhone,
  extractPhoneFromJid,
  isOpaqueJid,
} from "./delivery-contract.mjs";

export function normalizeEvolutionReceiptStatus(rawStatus) {
  if (typeof rawStatus !== "string") return null;
  const s = rawStatus.trim().toUpperCase();
  if (!s) return null;
  if (s === "DELIVERY_ACK" || s === "DELIVERED") return "delivered";
  if (s === "READ" || s === "PLAYED") return "read";
  if (s === "FAILED" || s === "ERROR") return "failed";
  if (s === "SERVER_ACK" || s === "SENT") return "accepted";
  return "unknown";
}

export function extractEvolutionInteractiveReply(message) {

  if (!message || typeof message !== "object" || Array.isArray(message)) return null;

  // 1. Evolution / Baileys standard button reply (buttonsResponseMessage)
  if (message.buttonsResponseMessage && typeof message.buttonsResponseMessage === "object") {
    const b = message.buttonsResponseMessage;
    const actionId = typeof b.selectedButtonId === "string" ? b.selectedButtonId.trim() : null;
    const displayText = typeof b.selectedDisplayText === "string" ? b.selectedDisplayText.trim() : null;
    if (actionId) {
      return { actionId, displayText: displayText || actionId };
    }
    return { actionId: null, displayText, isInteractive: true };
  }

  // 2. Evolution / Baileys template button reply (templateButtonReplyMessage)
  if (message.templateButtonReplyMessage && typeof message.templateButtonReplyMessage === "object") {
    const t = message.templateButtonReplyMessage;
    const actionId = typeof t.selectedId === "string" ? t.selectedId.trim() : null;
    const displayText = typeof t.selectedDisplayText === "string" ? t.selectedDisplayText.trim() : null;
    if (actionId) {
      return { actionId, displayText: displayText || actionId };
    }
    return { actionId: null, displayText, isInteractive: true };
  }

  // 3. Evolution / Baileys list reply (listResponseMessage)
  if (message.listResponseMessage && typeof message.listResponseMessage === "object") {
    const l = message.listResponseMessage;
    const actionId = typeof l.singleSelectReply?.selectedRowId === "string" ? l.singleSelectReply.selectedRowId.trim() : null;
    const displayText = typeof l.title === "string" ? l.title.trim() : null;
    if (actionId) {
      return { actionId, displayText: displayText || actionId };
    }
    return { actionId: null, displayText, isInteractive: true };
  }

  // 4. Meta Cloud API native interactive envelope
  if (message.interactive && typeof message.interactive === "object") {
    const inter = message.interactive;
    if (inter.type === "button_reply" && inter.button_reply && typeof inter.button_reply === "object") {
      const br = inter.button_reply;
      const actionId = typeof br.id === "string" ? br.id.trim() : null;
      const displayText = typeof br.title === "string" ? br.title.trim() : null;
      if (actionId) {
        return { actionId, displayText: displayText || actionId };
      }
      return { actionId: null, displayText, isInteractive: true };
    }
    if (inter.type === "list_reply" && inter.list_reply && typeof inter.list_reply === "object") {
      const lr = inter.list_reply;
      const actionId = typeof lr.id === "string" ? lr.id.trim() : null;
      const displayText = typeof lr.title === "string" ? lr.title.trim() : null;
      if (actionId) {
        return { actionId, displayText: displayText || actionId };
      }
      return { actionId: null, displayText, isInteractive: true };
    }
    return { actionId: null, displayText: null, isInteractive: true };
  }

  // 5. Meta Cloud API template quick reply callback normalized into message.button
  if (message.button && typeof message.button === "object") {
    const btn = message.button;
    const actionId = typeof btn.payload === "string" ? btn.payload.trim() : null;
    const displayText = typeof btn.text === "string" ? btn.text.trim() : null;
    if (actionId) {
      return { actionId, displayText: displayText || actionId };
    }
    return { actionId: null, displayText, isInteractive: true };
  }

  return null;
}

export function extractLocation(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;

  // Primary: message.locationMessage = { degreesLatitude, degreesLongitude, name, address }
  // Defensive: message.location = { latitude, longitude, name, address }
  const loc = message.locationMessage ?? message.location;
  if (!loc || typeof loc !== "object" || Array.isArray(loc)) return null;

  const lat = loc.degreesLatitude ?? loc.latitude;
  const lng = loc.degreesLongitude ?? loc.longitude;

  if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) return { error: "invalid" };
  if (typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) return { error: "invalid" };

  const name = typeof loc.name === "string" && loc.name.trim() ? loc.name.trim().slice(0, 200) : undefined;

  return {
    location: {
      latitude: lat,
      longitude: lng,
      ...(name ? { name } : {}),
    },
  };
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

  if (body.event === "messages.update" || body.event === "messages_update") {
    const dataItem = Array.isArray(body.data) ? body.data[0] : body.data;
    if (!dataItem || typeof dataItem !== "object") return reject("webhook_message_invalid");
    const key = dataItem.key;
    if (!key || typeof key !== "object") return reject("webhook_key_invalid");
    if (typeof key.id !== "string" || !/^[A-Za-z0-9_.=-]+$/u.test(key.id)
      || `${config.instance}:${key.id}`.length > 255) return reject("webhook_id_invalid");

    const rawStatus = typeof dataItem.status === "string"
      ? dataItem.status.trim()
      : typeof dataItem.update?.status === "string"
        ? dataItem.update.status.trim()
        : null;

    if (!rawStatus) return ignore("missing_update_status");

    const normalizedStatus = normalizeEvolutionReceiptStatus(rawStatus);
    if (!normalizedStatus) return ignore("missing_update_status");

    let providerEventAt = null;
    const rawTs = dataItem.messageTimestamp ?? dataItem.timestamp ?? dataItem.dateTime;
    if (typeof rawTs === "number" && Number.isFinite(rawTs) && rawTs > 0) {
      providerEventAt = new Date(rawTs > 1e11 ? rawTs : rawTs * 1000).toISOString();
    } else if (typeof rawTs === "string" && !isNaN(Date.parse(rawTs))) {
      providerEventAt = new Date(rawTs).toISOString();
    }

    let errorCode = null;
    let errorReason = null;
    const err = dataItem.error ?? dataItem.update?.error;
    if (err && typeof err === "object") {
      const c = err.code ?? err.error_code ?? err.statusCode;
      if (c !== undefined && c !== null) errorCode = String(c).trim().slice(0, 64) || null;
      const r = err.error_data?.details ?? err.message ?? err.details ?? err.reason;
      if (r !== undefined && r !== null) errorReason = String(r).trim().slice(0, 500) || null;
    } else if (err !== undefined && err !== null) {
      errorCode = String(err).trim().slice(0, 64) || null;
    }

    if (!errorReason) {
      const reasonField = dataItem.reason ?? dataItem.update?.reason ?? dataItem.message ?? dataItem.update?.message;
      if (typeof reasonField === "string" && reasonField.trim()) {
        errorReason = reasonField.trim().slice(0, 500);
      }
    }

    return {
      action: "receipt",
      receipt: {
        provider: config.provider,
        provider_message_id: `${config.instance}:${key.id}`,
        provider_status: rawStatus.slice(0, 64),
        normalized_status: normalizedStatus,
        ...(providerEventAt ? { provider_event_at: providerEventAt } : {}),
        ...(errorCode ? { provider_error_code: errorCode } : {}),
        ...(errorReason ? { provider_error_reason: errorReason } : {}),
      },
    };
  }

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

  // Official Meta Cloud API assigns message IDs in WAMID format containing '.' and base64 padding '='.
  // Allowed characters: [A-Za-z0-9_.=-]. Slashes, spaces, quotes, control chars remain strictly forbidden.
  if (typeof key.id !== "string" || !/^[A-Za-z0-9_.=-]+$/u.test(key.id)
    || `${config.instance}:${key.id}`.length > 255) return reject("webhook_id_invalid");

  const inbound = { provider: config.provider, provider_message_id: `${config.instance}:${key.id}`,
    phone_e164, country_code: "BR", limit: 3 };
  const message = body.data?.message;
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

  const interactiveReply = extractEvolutionInteractiveReply(message);
  if (interactiveReply) {
    if (interactiveReply.actionId) {
      if (typeof interactiveReply.actionId !== "string"
        || !interactiveReply.actionId
        || interactiveReply.actionId.length > 120
        || /\s/u.test(interactiveReply.actionId)) {
        return reject("webhook_interactive_id_invalid");
      }
      const rawText = (typeof interactiveReply.displayText === "string" && interactiveReply.displayText.trim())
        ? interactiveReply.displayText.trim()
        : "[Botão]";
      if (rawText.length > 500) return reject("webhook_text_invalid");
      return {
        action: "inbox",
        inbound: {
          ...inbound,
          raw_text: rawText,
          interactive_action_id: interactiveReply.actionId,
        },
      };
    }
    // Interactive event detected without an authoritative action ID (e.g. dropped by provider)
    // NEVER convert label into actionId and NEVER pass it to text command route.
    return ignore("unsupported_interactive_reply");
  }

  const locationResult = extractLocation(message);
  if (locationResult) {
    if (locationResult.error) return reject("webhook_location_invalid");
    const text = message.conversation ?? message.extendedTextMessage?.text;
    const raw_text = (typeof text === "string" && text.trim() && text.trim().length <= 500) ? text.trim() : undefined;
    return {
      action: "inbox",
      inbound: {
        ...inbound,
        location: locationResult.location,
        ...(raw_text ? { raw_text } : {}),
      },
    };
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

export function receiptAdmissionDecision(response) {
  response = httpResponse(response);
  if (response?.statusCode === 200 && (response.body?.outcome === "recorded" || response.body?.outcome === "unknown_provider_message_id")) {
    return { http_status: 200, reason: "receipt_recorded" };
  }
  return { http_status: response?.statusCode === 400 ? 400 : 503, reason: "receipt_not_acknowledged" };
}


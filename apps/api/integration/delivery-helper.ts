import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { channelOutboundMessageClaimResponseSchema } from "@contatocerto/shared";
import { claimDecision, transportDecision, confirmationDecision } from "../../../workflows/n8n/delivery-contract.mjs";

// Real API/PG, fake provider only. This exercises the exact pure functions
// embedded in the shared n8n delivery export without sending any WhatsApp.
export async function deliverClaim(app: FastifyInstance, key: string, provider: string, id?: string) {
  const headers = { "x-internal-key": key };
  const claim = await app.inject({ method: "POST", url: `/internal/channel/outbound/${id ?? "next"}/claim`, headers });
  assert.equal(claim.statusCode, 200);
  const body = channelOutboundMessageClaimResponseSchema.parse(claim.json());
  const gate = claimDecision({ statusCode: claim.statusCode, body }, provider);
  assert.equal(gate.action, "send");
  const message = gate.message;
  const accepted = transportDecision({ statusCode: 201, body: { key: {
    id: `provider-${message.id}`, fromMe: true, remoteJid: `${message.recipient_phone_e164.slice(1)}@s.whatsapp.net`,
  } } }, message);
  assert.equal(accepted.action, "sent");
  const confirm = await app.inject({ method: "POST", url: `/internal/channel/outbound/${message.id}/sent`, headers, payload: accepted.payload });
  assert.equal(confirmationDecision({ statusCode: confirm.statusCode, body: confirm.json() }, message, accepted).action, "complete");
  // Simulate a lost HTTP acknowledgement: repeat confirmation, not transport.
  const repeated = await app.inject({ method: "POST", url: `/internal/channel/outbound/${message.id}/sent`, headers, payload: accepted.payload });
  assert.equal(repeated.statusCode, 200);
  return message;
}

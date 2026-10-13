import assert from "node:assert/strict";
import test from "node:test";
import { readChannelOutboundConfig } from "./channel-outbound.js";

test("channel outbound config accepts positive lease seconds only", () => {
  assert.deepEqual(readChannelOutboundConfig({}), { processingLeaseSeconds: 60 });
  assert.deepEqual(readChannelOutboundConfig({ CHANNEL_OUTBOUND_PROCESSING_LEASE_SECONDS: "15" }), { processingLeaseSeconds: 15 });
  for (const value of ["0", "-1", "1.5", "abc"]) {
    assert.throws(() => readChannelOutboundConfig({ CHANNEL_OUTBOUND_PROCESSING_LEASE_SECONDS: value }));
  }
});

test("channel outbound config validates template variables", () => {
  // When auth enabled is not true, template variables can be present and validated
  assert.deepEqual(
    readChannelOutboundConfig({
      WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_NAME: "auth_otp_v1",
      WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_LANGUAGE: "pt_BR",
    }),
    {
      processingLeaseSeconds: 60,
      authTemplateName: "auth_otp_v1",
      authTemplateLanguage: "pt_BR",
    },
  );

  // Invalid template name format
  assert.throws(
    () => readChannelOutboundConfig({ WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_NAME: "INVALID NAME" }),
    /WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_NAME must be a lower-case Meta-safe identifier/,
  );

  // Invalid template language format
  assert.throws(
    () => readChannelOutboundConfig({ WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_LANGUAGE: "portugues" }),
    /WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_LANGUAGE must be standard format like pt_BR or en_US/,
  );

  // When PROFESSIONAL_AUTH_ENABLED is 'true', both template variables are strictly required
  assert.throws(
    () => readChannelOutboundConfig({ PROFESSIONAL_AUTH_ENABLED: "true" }),
    /WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_NAME is required when PROFESSIONAL_AUTH_ENABLED is 'true'/,
  );

  assert.throws(
    () =>
      readChannelOutboundConfig({
        PROFESSIONAL_AUTH_ENABLED: "true",
        WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_NAME: "auth_otp_v1",
      }),
    /WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_LANGUAGE is required when PROFESSIONAL_AUTH_ENABLED is 'true'/,
  );

  assert.deepEqual(
    readChannelOutboundConfig({
      PROFESSIONAL_AUTH_ENABLED: "true",
      WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_NAME: "auth_otp_v1",
      WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_LANGUAGE: "pt_BR",
    }),
    {
      processingLeaseSeconds: 60,
      authTemplateName: "auth_otp_v1",
      authTemplateLanguage: "pt_BR",
    },
  );
});


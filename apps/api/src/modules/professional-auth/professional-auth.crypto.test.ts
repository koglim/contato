import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createAuthEnvelope,
  createPublicChallengeReference,
  decryptAuthEnvelope,
  decryptAuthMessage,
  encryptAuthEnvelope,
  encryptAuthMessage,
  generateOtp,
  generateSessionToken,
  hashOtp,
  hashSessionToken,
  otpMatches,
  parseAuthEnvelope,
  PROFESSIONAL_AUTH_REFERENCE_PATTERN,
  resolvePublicChallengeReference,
  validateProfessionalAuthPepper,
} from "./professional-auth.crypto.js";

const pepper = "test-professional-auth-pepper-at-least-32-bytes";

test("OTP uses six digits, CSPRNG sampling and a challenge-bound derived key", () => {
  for (let index = 0; index < 200; index += 1) assert.match(generateOtp(), /^\d{6}$/u);
  const firstId = "11111111-1111-4111-8111-111111111111";
  const secondId = "22222222-2222-4222-8222-222222222222";
  const first = hashOtp(pepper, firstId, "123456");
  assert.notEqual(first, hashOtp(pepper, secondId, "123456"));
  assert.ok(otpMatches(first, hashOtp(pepper, firstId, "123456")));
  assert.equal(otpMatches(first, hashOtp(pepper, firstId, "654321")), false);
});

test("session token has at least 256 random bits and only its hash is stable", () => {
  const token = generateSessionToken();
  assert.ok(Buffer.from(token, "base64url").length >= 32);
  assert.equal(hashSessionToken(token).length, 64);
  assert.notEqual(generateSessionToken(), token);
});

test("authentication outbox content is encrypted, authenticated and domain separated", () => {
  const plain = "Seu código é 123456";
  const encrypted = encryptAuthMessage(pepper, plain);
  assert.equal(encrypted.includes("123456"), false);
  assert.equal(decryptAuthMessage(pepper, encrypted), plain);
  assert.throws(() => decryptAuthMessage(`${pepper}-other`, encrypted));
  assert.notEqual(hashOtp(pepper, randomUUID(), "123456"), encrypted);
});

test("public references are random authenticated envelopes and never expose the internal UUID", () => {
  const internalId = randomUUID();
  const first = createPublicChallengeReference(pepper, internalId);
  const second = createPublicChallengeReference(pepper, internalId);
  assert.match(first, PROFESSIONAL_AUTH_REFERENCE_PATTERN);
  assert.match(second, PROFESSIONAL_AUTH_REFERENCE_PATTERN);
  assert.notEqual(first, second);
  assert.equal(first.includes(internalId), false);
  assert.equal(resolvePublicChallengeReference(pepper, first), internalId);
  const tampered = `${first.slice(0, 10)}${first[10] === "A" ? "B" : "A"}${first.slice(11)}`;
  assert.throws(() => resolvePublicChallengeReference(pepper, tampered));
  assert.throws(() => resolvePublicChallengeReference(`${pepper}-other`, first));
});

test("pepper validation rejects missing, empty and short material", () => {
  assert.throws(() => validateProfessionalAuthPepper(undefined));
  assert.throws(() => validateProfessionalAuthPepper(""));
  assert.throws(() => validateProfessionalAuthPepper("short"));
  assert.doesNotThrow(() => validateProfessionalAuthPepper("x".repeat(32)));
});

test("structured auth envelope round-trip, validation and backward compatibility", () => {
  const otp = "847291";
  const envelope = createAuthEnvelope(otp);
  assert.deepEqual(JSON.parse(envelope), { version: 1, otp: "847291" });

  // Encrypted envelope round-trip
  const encrypted = encryptAuthEnvelope(pepper, otp);
  assert.equal(encrypted.includes(otp), false);
  const decrypted = decryptAuthEnvelope(pepper, encrypted);
  assert.equal(decrypted.otp, otp);

  // Invalid OTP code for envelope creation
  assert.throws(() => createAuthEnvelope("12345"), /invalid_otp_code/);
  assert.throws(() => createAuthEnvelope("1234567"), /invalid_otp_code/);
  assert.throws(() => createAuthEnvelope("abcdef"), /invalid_otp_code/);

  // Structured V1:
  // - valido -> PASS
  assert.deepEqual(parseAuthEnvelope(JSON.stringify({ version: 1, otp: "123456" })), { otp: "123456" });
  // - OTP 5 digitos -> FAIL
  assert.throws(() => parseAuthEnvelope(JSON.stringify({ version: 1, otp: "12345" })), /auth_envelope_invalid/);
  // - OTP 7 digitos -> FAIL
  assert.throws(() => parseAuthEnvelope(JSON.stringify({ version: 1, otp: "1234567" })), /auth_envelope_invalid/);
  // - letras -> FAIL
  assert.throws(() => parseAuthEnvelope(JSON.stringify({ version: 1, otp: "abcdef" })), /auth_envelope_invalid/);
  // - version 2 -> FAIL
  assert.throws(() => parseAuthEnvelope(JSON.stringify({ version: 2, otp: "123456" })), /auth_envelope_invalid/);
  // - campo ausente -> FAIL
  assert.throws(() => parseAuthEnvelope(JSON.stringify({ version: 1 })), /auth_envelope_invalid/);
  assert.throws(() => parseAuthEnvelope(JSON.stringify({ otp: "123456" })), /auth_envelope_invalid/);
  // - campos extras -> FAIL
  assert.throws(() => parseAuthEnvelope(JSON.stringify({ version: 1, otp: "123456", extra: true })), /auth_envelope_invalid/);

  // Valid JSON but not envelope:
  // - JSON string de seis digitos -> FAIL
  assert.throws(() => parseAuthEnvelope(JSON.stringify("123456")), /auth_envelope_invalid/);
  // - JSON number de seis digitos -> FAIL
  assert.throws(() => parseAuthEnvelope(JSON.stringify(123456)), /auth_envelope_invalid/);
  // - JSON array -> FAIL
  assert.throws(() => parseAuthEnvelope(JSON.stringify(["123456"])), /auth_envelope_invalid/);
  // - objeto sem version -> FAIL
  assert.throws(() => parseAuthEnvelope(JSON.stringify({ otp: "123456" })), /auth_envelope_invalid/);

  // Legacy:
  // - formato historico exato -> PASS
  assert.deepEqual(
    parseAuthEnvelope("Seu código ContatoCerto é 654321. Ele expira em 5 minutos."),
    { otp: "654321" },
  );
  // - prefixo extra -> FAIL
  assert.throws(
    () => parseAuthEnvelope("foo Seu código ContatoCerto é 654321. Ele expira em 5 minutos."),
    /auth_envelope_invalid/,
  );
  // - sufixo extra -> FAIL
  assert.throws(
    () => parseAuthEnvelope("Seu código ContatoCerto é 654321. Ele expira em 5 minutos. bar"),
    /auth_envelope_invalid/,
  );
  // - texto arbitrario contendo seis digitos -> FAIL
  assert.throws(() => parseAuthEnvelope("foo 123456 bar"), /auth_envelope_invalid/);
  assert.throws(() => parseAuthEnvelope("OTP: 123456"), /auth_envelope_invalid/);
  // - seis digitos isolados -> FAIL
  assert.throws(() => parseAuthEnvelope("123456"), /auth_envelope_invalid/);

  // Historical backward compatibility with legacy encrypted text
  const legacyText = "Seu código ContatoCerto é 654321. Ele expira em 5 minutos.";
  const legacyEncrypted = encryptAuthMessage(pepper, legacyText);
  const legacyParsed = decryptAuthEnvelope(pepper, legacyEncrypted);
  assert.equal(legacyParsed.otp, "654321");

  // Error message safety: OTP is never exposed in error message
  try {
    createAuthEnvelope("12345");
  } catch (err: unknown) {
    if (err instanceof Error) {
      assert.equal(err.message.includes("12345"), false);
    } else {
      assert.fail("expected Error instance");
    }
  }

  try {
    parseAuthEnvelope(JSON.stringify({ version: 1, otp: "999888" }).replace("999888", "bad"));
  } catch (err: unknown) {
    if (err instanceof Error) {
      assert.equal(err.message.includes("999888"), false);
      assert.equal(err.message, "auth_envelope_invalid");
    } else {
      assert.fail("expected Error instance");
    }
  }
});

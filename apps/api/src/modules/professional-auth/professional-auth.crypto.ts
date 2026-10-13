import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const OTP_TTL_SECONDS = 300;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_COOLDOWN_SECONDS = 60;
export const OTP_HOURLY_LIMIT = 5;
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
export const PROFESSIONAL_AUTH_REFERENCE_PATTERN = /^par1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{23}$/u;

const KDF_SALT = Buffer.from("contatocerto:professional-auth:v1", "utf8");
const REFERENCE_AAD = Buffer.from("professional-auth:reference:v1", "utf8");

export function validateProfessionalAuthPepper(pepper: string | undefined): asserts pepper is string {
  if (!pepper || Buffer.byteLength(pepper, "utf8") < 32) {
    throw new Error("PROFESSIONAL_AUTH_PEPPER must contain at least 32 bytes");
  }
}

function deriveKey(pepper: string, purpose: "otp" | "outbox" | "reference") {
  validateProfessionalAuthPepper(pepper);
  return Buffer.from(hkdfSync("sha256", Buffer.from(pepper, "utf8"), KDF_SALT, `professional-auth:${purpose}:v1`, 32));
}

export function generateOtp() {
  const limit = 0x1_0000_0000 - (0x1_0000_0000 % 1_000_000);
  let value: number;
  do { value = randomBytes(4).readUInt32BE(0); } while (value >= limit);
  return String(value % 1_000_000).padStart(6, "0");
}

export function hashOtp(pepper: string, challengeId: string, otp: string) {
  return createHmac("sha256", deriveKey(pepper, "otp")).update(`${challengeId}:${otp}`).digest("hex");
}

export function otpMatches(expectedHex: string, candidateHex: string) {
  const expected = Buffer.from(expectedHex, "hex");
  const candidate = Buffer.from(candidateHex, "hex");
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

export function generateSessionToken() { return randomBytes(32).toString("base64url"); }
export function hashSessionToken(token: string) { return createHash("sha256").update(token).digest("hex"); }

export function encryptAuthMessage(pepper: string, plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(pepper, "outbox"), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `enc:v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptAuthMessage(pepper: string, value: string) {
  const [marker, version, iv, tag, ciphertext] = value.split(":");
  if (marker !== "enc" || version !== "v1" || !iv || !tag || !ciphertext) throw new Error("auth_outbox_payload_invalid");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(pepper, "outbox"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export interface ProfessionalAuthEnvelopeV1 {
  version: 1;
  otp: string;
}

export function createAuthEnvelope(otp: string): string {
  if (!/^\d{6}$/.test(otp)) {
    throw new Error("invalid_otp_code");
  }
  return JSON.stringify({ version: 1, otp });
}

export function parseAuthEnvelope(decrypted: string): { otp: string } {
  try {
    const parsed = JSON.parse(decrypted);
    if (parsed && typeof parsed === "object") {
      if (
        parsed.version === 1 &&
        typeof parsed.otp === "string" &&
        /^\d{6}$/.test(parsed.otp)
      ) {
        return { otp: parsed.otp };
      }
      throw new Error("auth_envelope_invalid");
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "auth_envelope_invalid") {
      throw err;
    }
    // Fall back to historical pattern only if decrypted is not a JSON object
  }
  const match = /\b(\d{6})\b/u.exec(decrypted);
  if (match) {
    return { otp: match[1] };
  }
  throw new Error("auth_envelope_invalid");
}

export function encryptAuthEnvelope(pepper: string, otp: string): string {
  return encryptAuthMessage(pepper, createAuthEnvelope(otp));
}

export function decryptAuthEnvelope(pepper: string, value: string): { otp: string } {
  const decrypted = decryptAuthMessage(pepper, value);
  return parseAuthEnvelope(decrypted);
}

function uuidToBytes(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) throw new Error("invalid_challenge_id");
  return Buffer.from(id.replaceAll("-", ""), "hex");
}

function bytesToUuid(value: Buffer) {
  const hex = value.toString("hex");
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id)) throw new Error("invalid_challenge_reference");
  return id;
}

export function createPublicChallengeReference(pepper: string, challengeId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(pepper, "reference"), iv);
  cipher.setAAD(REFERENCE_AAD);
  const payload = Buffer.concat([Buffer.from([1]), uuidToBytes(challengeId)]);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  return `par1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function resolvePublicChallengeReference(pepper: string, reference: string) {
  if (!PROFESSIONAL_AUTH_REFERENCE_PATTERN.test(reference)) throw new Error("invalid_challenge_reference");
  const [, iv, tag, ciphertext] = reference.split(".");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(pepper, "reference"), Buffer.from(iv!, "base64url"));
  decipher.setAAD(REFERENCE_AAD);
  decipher.setAuthTag(Buffer.from(tag!, "base64url"));
  const payload = Buffer.concat([decipher.update(Buffer.from(ciphertext!, "base64url")), decipher.final()]);
  if (payload.length !== 17 || payload[0] !== 1) throw new Error("invalid_challenge_reference");
  return bytesToUuid(payload.subarray(1));
}

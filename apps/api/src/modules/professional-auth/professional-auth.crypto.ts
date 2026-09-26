import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const OTP_TTL_SECONDS = 300;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_COOLDOWN_SECONDS = 60;
export const OTP_HOURLY_LIMIT = 5;
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export function generateOtp() {
  const limit = 0x1_0000_0000 - (0x1_0000_0000 % 1_000_000);
  let value: number;
  do { value = randomBytes(4).readUInt32BE(0); } while (value >= limit);
  return String(value % 1_000_000).padStart(6, "0");
}
export function hashOtp(pepper: string, challengeId: string, otp: string) { return createHmac("sha256", pepper).update(`${challengeId}:${otp}`).digest("hex"); }
export function otpMatches(expectedHex: string, candidateHex: string) { const a=Buffer.from(expectedHex,"hex"),b=Buffer.from(candidateHex,"hex"); return a.length===b.length&&timingSafeEqual(a,b); }
export function generateSessionToken() { return randomBytes(32).toString("base64url"); }
export function hashSessionToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
function encryptionKey(pepper: string) { return createHash("sha256").update(`outbox:${pepper}`).digest(); }
export function encryptAuthMessage(pepper: string, plaintext: string) { const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",encryptionKey(pepper),iv); const ciphertext=Buffer.concat([cipher.update(plaintext,"utf8"),cipher.final()]); return `enc:v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`; }
export function decryptAuthMessage(pepper: string, value: string) { const [marker,version,iv,tag,ciphertext]=value.split(":"); if(marker!=="enc"||version!=="v1"||!iv||!tag||!ciphertext)throw new Error("auth_outbox_payload_invalid"); const decipher=createDecipheriv("aes-256-gcm",encryptionKey(pepper),Buffer.from(iv,"base64url")); decipher.setAuthTag(Buffer.from(tag,"base64url")); return Buffer.concat([decipher.update(Buffer.from(ciphertext,"base64url")),decipher.final()]).toString("utf8"); }

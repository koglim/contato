import { randomUUID } from "node:crypto";
import { PostgresProfessionalAuthRepository } from "./professional-auth.repository.js";
import {
  createPublicChallengeReference,
  encryptAuthMessage,
  generateOtp,
  generateSessionToken,
  hashOtp,
  hashSessionToken,
  OTP_TTL_SECONDS,
  resolvePublicChallengeReference,
  SESSION_TTL_SECONDS,
  validateProfessionalAuthPepper,
} from "./professional-auth.crypto.js";

export class ProfessionalAuthService {
  private readonly pepper: string;

  constructor(
    private readonly repository = new PostgresProfessionalAuthRepository(),
    pepper = process.env.PROFESSIONAL_AUTH_PEPPER,
  ) {
    validateProfessionalAuthPepper(pepper);
    this.pepper = pepper;
  }

  async requestChallenge(phone: string) {
    const id = randomUUID();
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);
    const internalId = await this.repository.createChallenge({
      id,
      phone,
      codeHash: hashOtp(this.pepper, id, otp),
      expiresAt,
      encryptedMessage: encryptAuthMessage(this.pepper, `Seu código ContatoCerto é ${otp}. Ele expira em 5 minutos.`),
      provider: "evolution",
    });
    return {
      accepted: true,
      challenge_reference: createPublicChallengeReference(this.pepper, internalId ?? randomUUID()),
      expires_in_seconds: OTP_TTL_SECONDS,
    };
  }

  async verify(reference: string, code: string) {
    let internalId: string;
    try { internalId = resolvePublicChallengeReference(this.pepper, reference); }
    catch { return { ok: false as const }; }
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
    const result = await this.repository.verifyChallenge(
      internalId,
      hashOtp(this.pepper, internalId, code),
      hashSessionToken(token),
      expiresAt,
    );
    return result
      ? { ok: true as const, session_token: token, expires_in_seconds: SESSION_TTL_SECONDS }
      : { ok: false as const };
  }

  authenticate(token: string | undefined) {
    return token ? this.repository.findSession(hashSessionToken(token)) : Promise.resolve(null);
  }

  revoke(token: string | undefined) {
    return token ? this.repository.revokeSession(hashSessionToken(token)) : Promise.resolve(false);
  }
}

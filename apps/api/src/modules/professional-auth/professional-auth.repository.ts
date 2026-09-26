import { query, withTransaction } from "../../database/connection.js";
import type { SessionPrincipal } from "./professional-auth.types.js";
import { OTP_COOLDOWN_SECONDS, OTP_HOURLY_LIMIT, OTP_MAX_ATTEMPTS, otpMatches } from "./professional-auth.crypto.js";

type IdentifierRow = { id: string; account_id: string; account_status: "active" | "blocked" };
type ChallengeRow = {
  id: string;
  account_id: string;
  account_status: "active" | "blocked";
  code_hash: string;
  expires_at: Date;
  attempts: number;
  consumed_at: Date | null;
  invalidated_at: Date | null;
};

export class PostgresProfessionalAuthRepository {
  createChallenge(input: { id: string; phone: string; codeHash: string; expiresAt: Date; encryptedMessage: string; provider: string }) {
    return withTransaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,22))", [input.phone]);
      const found = await client.query<IdentifierRow>(
        `SELECT i.id,a.id account_id,a.status account_status
           FROM account_identifiers i
           JOIN accounts a ON a.id=i.account_id
          WHERE i.kind='phone' AND i.normalized_value=$1 AND i.verified_at IS NOT NULL`,
        [input.phone],
      );
      const identity = found.rows[0];
      if (!identity || identity.account_status !== "active") return null;

      const recent = await client.query<{ id: string; created_at: Date }>(
        `SELECT id,created_at FROM professional_auth_challenges
          WHERE account_identifier_id=$1 ORDER BY created_at DESC LIMIT 1`,
        [identity.id],
      );
      if (recent.rows[0] && recent.rows[0].created_at.getTime() > Date.now() - OTP_COOLDOWN_SECONDS * 1000) {
        return recent.rows[0].id;
      }
      const hourly = await client.query<{ count: string }>(
        `SELECT count(*)::text count FROM professional_auth_challenges
          WHERE account_identifier_id=$1 AND created_at>NOW()-INTERVAL '1 hour'`,
        [identity.id],
      );
      if (Number(hourly.rows[0]?.count ?? 0) >= OTP_HOURLY_LIMIT) return null;

      await client.query(
        `WITH superseded AS (
           UPDATE professional_auth_challenges
              SET invalidated_at=clock_timestamp()
            WHERE account_identifier_id=$1
              AND consumed_at IS NULL AND invalidated_at IS NULL
           RETURNING outbound_id
         ), closed AS (
           UPDATE channel_outbound_messages outbound
              SET status='failed', last_error_code='auth_challenge_superseded',
                  administrative_closed_at=clock_timestamp(), processing_token=NULL,
                  processing_started_at=NULL, next_attempt_at=NULL
             FROM superseded
            WHERE outbound.id=superseded.outbound_id
              AND outbound.status IN ('pending','failed')
              AND outbound.provider_message_id IS NULL
              AND outbound.delivery_hold_reason IS NULL
              AND outbound.administrative_closed_at IS NULL
           RETURNING outbound.id
         )
         INSERT INTO channel_transport_events(outbound_id,event_key,action,reason,payload_hash,result)
         SELECT id,'professional_auth_superseded_v1','close','auth_challenge_superseded',
           encode(digest(id::text||':auth_challenge_superseded','sha256'),'hex'),
           '{"status":"failed","reason":"auth_challenge_superseded"}'::jsonb
         FROM closed ON CONFLICT(outbound_id,event_key) DO NOTHING`,
        [identity.id],
      );

      const outbound = await client.query<{ id: string }>(
        `INSERT INTO channel_outbound_messages(
           channel_inbound_message_id,purpose,provider,recipient_phone_e164,text_content,business_key,expires_at
         ) VALUES(NULL,'professional_auth_challenge',$1,$2,$3,$4,$5)
         ON CONFLICT (business_key) WHERE business_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [input.provider, input.phone, input.encryptedMessage, `professional-auth:${input.id}`, input.expiresAt],
      );
      if (!outbound.rows[0]) throw new Error("professional_auth_outbound_conflict");
      await client.query(
        `INSERT INTO professional_auth_challenges(id,account_identifier_id,code_hash,expires_at,outbound_id)
         VALUES($1,$2,$3,$4,$5)`,
        [input.id, identity.id, input.codeHash, input.expiresAt, outbound.rows[0].id],
      );
      return input.id;
    });
  }

  verifyChallenge(internalId: string, candidateHash: string, tokenHash: string, sessionExpiresAt: Date) {
    return withTransaction(async client => {
      const result = await client.query<ChallengeRow>(
        `SELECT c.*,i.account_id,a.status account_status
           FROM professional_auth_challenges c
           JOIN account_identifiers i ON i.id=c.account_identifier_id
           JOIN accounts a ON a.id=i.account_id
          WHERE c.id=$1 AND i.kind='phone' AND i.verified_at IS NOT NULL
          FOR UPDATE OF c`,
        [internalId],
      );
      const row = result.rows[0];
      if (!row || row.consumed_at || row.invalidated_at || row.expires_at <= new Date()
        || row.attempts >= OTP_MAX_ATTEMPTS || row.account_status !== "active") return null;
      if (!otpMatches(row.code_hash, candidateHash)) {
        await client.query(
          `UPDATE professional_auth_challenges
              SET attempts=attempts+1,
                  invalidated_at=CASE WHEN attempts+1>=$2 THEN NOW() ELSE invalidated_at END
            WHERE id=$1`,
          [internalId, OTP_MAX_ATTEMPTS],
        );
        return null;
      }
      const consumed = await client.query(
        `UPDATE professional_auth_challenges SET consumed_at=NOW()
          WHERE id=$1 AND consumed_at IS NULL AND invalidated_at IS NULL RETURNING id`,
        [internalId],
      );
      if (consumed.rows.length !== 1) return null;
      const session = await client.query<{ id: string }>(
        `INSERT INTO professional_sessions(account_id,token_hash,expires_at) VALUES($1,$2,$3) RETURNING id`,
        [row.account_id, tokenHash, sessionExpiresAt],
      );
      return { sessionId: session.rows[0]!.id, accountId: row.account_id };
    });
  }

  async findSession(tokenHash: string): Promise<SessionPrincipal | null> {
    const result = await query<{ session_id: string; account_id: string; expires_at: Date }>(
      `SELECT s.id session_id,s.account_id,s.expires_at
         FROM professional_sessions s JOIN accounts a ON a.id=s.account_id
        WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>NOW() AND a.status='active'`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row ? { sessionId: row.session_id, accountId: row.account_id, expiresAt: row.expires_at } : null;
  }

  async revokeSession(tokenHash: string) {
    const result = await query(
      `UPDATE professional_sessions SET revoked_at=COALESCE(revoked_at,NOW()) WHERE token_hash=$1`,
      [tokenHash],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listProfiles(accountId: string) {
    const result = await query<{ id: string; display_name: string; slug: string; role: string }>(
      `SELECT p.id,p.display_name,p.slug,m.role
         FROM professional_memberships m JOIN professionals p ON p.id=m.professional_id
        WHERE m.account_id=$1 AND m.status='active' ORDER BY p.display_name,p.id`,
      [accountId],
    );
    return result.rows;
  }
}

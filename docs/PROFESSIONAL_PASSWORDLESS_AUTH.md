# Professional passwordless authentication

## Trust boundaries

The browser talks only to the Next.js BFF. The BFF keeps `INTERNAL_API_KEY` server-side and stores the opaque professional session token in an HttpOnly, SameSite=Lax cookie. The API and PostgreSQL are authoritative for sessions, account status and active memberships. An identifier proves account possession; it does not prove ownership of a professional profile.

## Rollout

`PROFESSIONAL_AUTH_ENABLED=false` is the default and preserves the demo password, signed demo cookie and `DASHBOARD_PROFESSIONAL_ID`. When true, the demo path is disabled and `PROFESSIONAL_AUTH_PEPPER` must contain at least 32 bytes in the API. Startup rejects missing, empty or short values. PR #13 introduces self-service signup (provisional account + identifier creation) and legacy profile claim via `POST /profiles/:professionalId/claim` (migration 024).

## Challenge lifecycle

Only a verified phone `account_identifier` for an active, already provisioned account can create a deliverable challenge. Public responses remain generic for existing, unknown, blocked, unverified, cooldown and hourly-limited identifiers. Codes contain six CSPRNG digits, expire after five minutes and allow five attempts. A PostgreSQL advisory transaction lock serializes requests per phone, enforcing a 60-second cooldown and five challenges per hour.

The database UUID is an internal challenge ID and is never returned to the browser. The public `par1` reference is a randomized AES-256-GCM envelope containing a version byte and the internal UUID. Its nonce changes on every response, including cooldown responses for the same internal challenge. Invalid, corrupt and fake references produce the same `invalid_or_expired_code` contract.

HKDF-SHA-256 derives independent versioned subkeys for `professional-auth:otp:v1`, `professional-auth:outbox:v1` and `professional-auth:reference:v1`. The challenge stores only an HMAC made with the OTP subkey, and comparison is constant-time. The durable Outbox payload is authenticated AES-256-GCM encrypted with the Outbox subkey and is decrypted only while producing an authorized dispatcher claim. This is defense in depth for direct column exposure; it does not replace database, disk or backup encryption. The OTP is never stored in plaintext or logged.

Creating a new real challenge atomically invalidates every prior unconsumed challenge for the identifier. Pending or retryable unsent Outbox rows are terminalized with `auth_challenge_superseded` and an immutable transport audit event. Confirmed sent evidence is unchanged; an in-flight uncertain delivery keeps its reconciliation evidence, while the superseded OTP can no longer authenticate.

## Sessions and logout

Successful atomic challenge consumption creates one independent seven-day session. The 256-bit random token is returned once; PostgreSQL stores only its SHA-256 hash. Every authorization checks that the session is unexpired and unrevoked and that the account remains active. Logout records `revoked_at` and clears the cookie even if the API session was already invalid.

## Ownership and profiles

The session resolves the account, then active `professional_memberships`. Zero profiles return an authenticated `no_profiles` state, one opens directly and multiple profiles can be selected. The selected ID and cookie are resource references only. Every self-service API read and mutation revalidates the session, active account and exact active membership, so a blocked account or revoked membership denies the next request immediately.

The authenticated BFF uses `/internal/professional-auth/profiles/:professionalId/...` for dashboard reads and mutations. Only this boundary may act for a session. It authorizes first and then delegates to the existing professionals, services, areas, availability and catalog domain routes; `INTERNAL_API_KEY` alone never establishes ownership.

## Outbox and n8n

`professional_auth_challenge` is a distinct purpose with business key `professional-auth:<challenge-id>`. Its `expires_at` matches the challenge. A versioned 30-second safety margin prevents `claim(id)` and `claimNextPending()` from releasing plaintext when insufficient OTP lifetime remains. Pending and retryable rows become `failed` with `auth_challenge_expired` and an immutable audit event. A processing or held row is not falsely classified as unsent; its evidence remains available for confirmation or reconciliation, while it cannot receive a new claim. Retries retain the same encrypted OTP. Versioned n8n delivery contracts accept the purpose; no remote workflow is changed by this repository update.

## CSRF

Cookies use HttpOnly, Secure in production, SameSite=Lax and Path `/`. When passwordless auth is enabled, every state-changing BFF route compares `Origin` with the BFF origin and fails closed when the header is missing or foreign. Demo mode keeps its previous behavior. This matches the same-origin browser topology without adding a second token framework.

## Rollback and future boundary

Migration 022 allows rollback only while challenges, sessions and authentication outboxes are empty. Otherwise it raises `PROFESSIONAL_AUTH_ROLLBACK_BLOCKED` (`P0022`) to preserve evidence. PR #13 implements signup, identifier verification, legacy profile discovery and claim via migration 024 (`P0024`). Team role management and subscription billing remain separate future work.

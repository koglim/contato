# Professional passwordless authentication

## Trust boundaries

The browser talks only to the Next.js BFF. The BFF keeps `INTERNAL_API_KEY` server-side and stores the opaque professional session token in an HttpOnly, SameSite=Lax cookie. The API and PostgreSQL are authoritative for sessions, account status and active memberships. An identifier proves account possession; it does not prove ownership of a professional profile.

## Rollout

`PROFESSIONAL_AUTH_ENABLED=false` is the default and preserves the demo password, signed demo cookie and `DASHBOARD_PROFESSIONAL_ID`. When true, the demo path is disabled and `PROFESSIONAL_AUTH_PEPPER` is mandatory in the API. No signup, profile claim or implicit membership creation exists in this version.

## Challenge lifecycle

Only a verified phone `account_identifier` for an active, already provisioned account can create a deliverable challenge. Public responses remain generic for unknown, blocked and rate-limited identifiers. Codes contain six CSPRNG digits, expire after five minutes and allow five attempts. A PostgreSQL advisory transaction lock serializes requests per phone, enforcing a 60-second cooldown and five challenges per hour.

The challenge stores only `HMAC-SHA-256(pepper, challenge-id + ":" + otp)`. Comparison is constant-time. The durable Outbox payload is AES-256-GCM encrypted with a key derived from the API-only pepper and is decrypted only while producing the authenticated dispatcher claim. The OTP is never stored in plaintext or logged.

## Sessions and logout

Successful atomic challenge consumption creates one independent seven-day session. The 256-bit random token is returned once; PostgreSQL stores only its SHA-256 hash. Every authorization checks that the session is unexpired and unrevoked and that the account remains active. Logout records `revoked_at` and clears the cookie even if the API session was already invalid.

## Ownership and profiles

The session resolves the account, then active `professional_memberships`. Zero profiles show a safe empty state, one opens directly and multiple profiles can be selected. The selected ID is a resource reference; the API rechecks the active membership. A blocked account or revoked membership denies the next request immediately.

## Outbox and n8n

`professional_auth_challenge` is a distinct purpose with business key `professional-auth:<challenge-id>`. Its `expires_at` matches the challenge. Claims exclude expired rows and queue diagnostics terminalize them, so retries retain the same encrypted content and an expired OTP cannot be transported. Versioned n8n delivery contracts accept the purpose; no remote workflow is changed by this repository update.

## CSRF

Cookies use HttpOnly, Secure in production, SameSite=Lax and Path `/`. State-changing BFF routes accept only POST/PATCH/DELETE and compare the request Origin with the BFF origin. This matches the same-origin browser topology without adding a second token framework.

## Rollback and future boundary

Migration 022 allows rollback only while challenges, sessions and authentication outboxes are empty. Otherwise it raises `PROFESSIONAL_AUTH_ROLLBACK_BLOCKED` (`P0022`) to preserve evidence. Signup, identifier verification, historical profile claim and team management remain separate future work. Before team role management, membership audit events need actor/source attribution.

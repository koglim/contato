# Professional Identity & Ownership Foundation v1

Migration `021_add_professional_identity_foundation` establishes identity and
professional access without changing the current dashboard login or any customer
flow. It creates no accounts, identifiers, or memberships for existing records.

## Boundaries

- `accounts` represents an individual principal, not a professional profile.
  Its initial statuses are `active` and `blocked`; a blocked account cannot
  obtain operational access even with an active membership.
- `account_identifiers` holds account-owned phone/email identifiers. Profile
  fields such as `professionals.phone_e164` and `professionals.email` remain
  business contact information, never authentication credentials or ownership
  evidence. An identifier's presence does not prove control: only a non-null
  `verified_at` counts as verified. Creation always leaves it null.
- `professional_memberships` is the account-to-professional authorization
  relationship. Roles are `owner`, `admin`, and `member`; statuses are `active`
  and `revoked`. The access policy currently requires an existing active account,
  an active membership for the exact professional, and at least one verified
  identifier. A revoked membership never authorizes. Fine-grained RBAC is not
  implemented in this foundation.

The unique `(kind, normalized_value)` index prevents an identifier from
belonging to two accounts, including concurrent registration attempts. Phone
values must be canonical E.164 (`+` and 8–15 digits, first digit nonzero).
Email uses a deliberately conservative ASCII policy: trim outer whitespace,
lowercase the full value, reject malformed addresses, and keep dots and plus
tags intact. Both application validation and database checks enforce the
canonical representation. Verification is a separate future trusted flow; no
OTP, magic token, password, or login is introduced here.

## Access and audit

`ProfessionalAccessService.resolveProfessionalAccess({ accountId,
professionalId })` returns a typed status (`authorized`, `not_member`,
`membership_revoked`, `account_blocked`, `identity_unverified`, or `not_found`).
The repository reads the account, exact membership, professional existence, and
verified-identifier state in one database statement. It does not infer a
membership from a profile contact or from a professional ID provided by a
browser. The future dashboard/BFF must derive the account from an authenticated
server-side session and invoke API-side authorization for every protected
operation; a browser-selected professional ID is only a requested resource,
never proof of ownership. This service is not connected to the demo dashboard
in this PR.

`professional_membership_events` records membership creation and role/status
changes using IDs, previous/new role and status, and timestamp. It contains no
phone, email, prompt, or message text. Triggers make events append-only and
prevent deletion of memberships. Account identifiers are not copied into the
audit trail. Initial provisioning methods are internal repository methods, not
public API routes.

## Staged adoption and rollback

There is intentionally no backfill from `professionals.phone_e164` or email:
historical profile contact data does not establish who controls a number or
profile. A later explicit claim/onboarding/admin flow must verify an identifier
and establish a membership. Existing dashboard demo credentials and ENV values
remain untouched. Multiple memberships per account and multiple accounts per
professional support future companies, assistants, and teams without changing
the core relationship.

The migration down locks and checks all four new tables. If any contains data,
it raises `P0021 / PROFESSIONAL_IDENTITY_ROLLBACK_BLOCKED` and leaves all data
and schema intact; do not delete real identities to force a downgrade. Only an
empty installation can down/reapply safely. CI tests protected and compatible
rollback and integration after reapply. Production rollback with real identity
data should use roll-forward or a full, coordinated backup restore.

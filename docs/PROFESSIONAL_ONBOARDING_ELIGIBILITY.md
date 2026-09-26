# Professional onboarding and eligibility v1

An authenticated active account with at least one verified identifier may explicitly create one or more professional profiles. Creation writes the `professionals` row with `management_mode = 'account_managed'`, active `owner` membership, and append-only membership event in one PostgreSQL transaction. The profile starts as `draft`, unavailable, and without the administrative `is_verified` signal.

Migration 023 adds `actor_account_id` and `source` to membership events. Self onboarding uses transaction-local settings and records the authenticated account with `source=self_onboarding`. Existing internal provisioning records `actor_account_id=NULL` and `source=internal_provisioning`. The connection pool never receives session-global audit state. Rollback is refused with `P0023 / PROFESSIONAL_ONBOARDING_AUDIT_ROLLBACK_BLOCKED` once 023 provenance exists.

`eligibility-v1` is calculated from current data and is never persisted. Publication readiness requires a verified identity linked through an active membership and account, a valid basic profile, one active professional service whose catalog service is active, and one service area. Administrative marketplace verification, reviews, availability, and future subscriptions are not publication requirements.

Only an active owner or admin membership can publish or unpublish. Publish rechecks eligibility and changes `draft` to `active`; it does not enable availability. Unpublish changes `active` to `draft` and disables availability. A suspended profile cannot use either self-service transition. Availability can be enabled only for an active, currently eligible profile; disabling it remains allowed.

The matching query implements a selective matching guard: `legacy_unmanaged` profiles are matched without requiring a membership, preserving valid legacy production results. `account_managed` profiles (created by self-onboarding or legacy claim) strictly require an active owner or admin membership, an active account, and a verified phone identifier. Paid entitlement will be added to the capability policy later.

The dashboard aggregate returns the eligibility snapshot with profile, service, area, and catalog data. The UI renders a checklist from that snapshot, offers contextual links, exposes dedicated publish/unpublish actions, and supports explicit profile creation for authenticated accounts with zero profiles. Every browser mutation continues through the same-origin protected BFF and the authenticated professional API.

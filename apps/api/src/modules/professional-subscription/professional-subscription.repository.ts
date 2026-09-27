import type {
  ProfessionalEntitlementSnapshot,
  ProfessionalEntitlementState,
  ProfessionalEntitlementReason,
  GrantProfessionalSubscriptionInput,
  ExtendProfessionalSubscriptionInput,
  ReactivateProfessionalSubscriptionInput,
} from "@contatocerto/shared";
import { professionalEntitlementSnapshotSchema } from "@contatocerto/shared";
import { type DatabaseClient, type SqlValue, query, withTransaction } from "../../database/connection.js";

type ProfessionalRow = {
  id: string;
  management_mode: "legacy_unmanaged" | "account_managed";
};

type SubscriptionWithPlanRow = {
  id: string;
  professional_id: string;
  plan_id: string;
  starts_at: string;
  ends_at: string;
  revoked_at: string | null;
  plan_code: string;
  plan_is_active: boolean;
  plan_has_marketplace_access: boolean;
};

type PlanRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

export class PostgresProfessionalSubscriptionRepository {
  constructor(
    private readonly transaction: typeof withTransaction = withTransaction,
    private readonly runQuery: typeof query = query,
  ) {}

  async getEntitlementSnapshot(
    professionalId: string,
    client?: DatabaseClient,
  ): Promise<ProfessionalEntitlementSnapshot> {
    // Typed query executor: delegates to client.query<T> when inside a transaction,
    // or to the global query function otherwise. All callers pass SqlValue[] params.
    async function runQ<T extends Record<string, unknown>>(text: string, values: SqlValue[]) {
      if (client) return client.query<T>(text, values);
      return query<T>(text, values);
    }

    const professionalRes = await runQ<ProfessionalRow>(
      `SELECT id, management_mode FROM professionals WHERE id = $1`,
      [professionalId],
    );
    const professional = professionalRes.rows[0];
    if (!professional) {
      throw new Error("professional_not_found");
    }

    if (professional.management_mode === "legacy_unmanaged") {
      return professionalEntitlementSnapshotSchema.parse({
        policy_version: "entitlement-v1",
        professional_id: professional.id,
        management_mode: "legacy_unmanaged",
        subscription_required: false,
        state: "legacy_exempt",
        plan_code: null,
        starts_at: null,
        ends_at: null,
        has_marketplace_access: true,
        reasons: [],
      });
    }

    const subRes = await runQ<SubscriptionWithPlanRow>(
      `SELECT
        ps.id,
        ps.professional_id,
        ps.plan_id,
        ps.starts_at::text,
        ps.ends_at::text,
        ps.revoked_at::text,
        sp.code AS plan_code,
        sp.is_active AS plan_is_active,
        EXISTS (
          SELECT 1 FROM subscription_plan_entitlements spe
          WHERE spe.plan_id = sp.id AND spe.entitlement_key = 'marketplace_access'
        ) AS plan_has_marketplace_access
      FROM professional_subscriptions ps
      JOIN subscription_plans sp ON sp.id = ps.plan_id
      WHERE ps.professional_id = $1`,
      [professionalId],
    );

    const sub = subRes.rows[0] as SubscriptionWithPlanRow | undefined;
    if (!sub) {
      return professionalEntitlementSnapshotSchema.parse({
        policy_version: "entitlement-v1",
        professional_id: professional.id,
        management_mode: "account_managed",
        subscription_required: true,
        state: "none",
        plan_code: null,
        starts_at: null,
        ends_at: null,
        has_marketplace_access: false,
        reasons: ["subscription_required"],
      });
    }

    const now = new Date();
    const startsAt = new Date(sub.starts_at);
    const endsAt = new Date(sub.ends_at);
    const isRevoked = sub.revoked_at !== null;

    let state: ProfessionalEntitlementState;
    let hasMarketplaceAccess = false;
    const reasons: ProfessionalEntitlementReason[] = [];

    if (isRevoked) {
      state = "revoked";
      reasons.push("subscription_revoked");
    } else if (!sub.plan_is_active || !sub.plan_has_marketplace_access) {
      state = "plan_inactive";
      reasons.push("subscription_plan_inactive");
    } else if (endsAt.getTime() <= now.getTime()) {
      state = "expired";
      reasons.push("subscription_expired");
    } else if (startsAt.getTime() > now.getTime()) {
      state = "not_started";
      reasons.push("subscription_not_started");
    } else {
      state = "active";
      hasMarketplaceAccess = true;
    }

    return professionalEntitlementSnapshotSchema.parse({
      policy_version: "entitlement-v1",
      professional_id: professional.id,
      management_mode: "account_managed",
      subscription_required: true,
      state,
      plan_code: sub.plan_code,
      starts_at: new Date(sub.starts_at).toISOString(),
      ends_at: new Date(sub.ends_at).toISOString(),
      has_marketplace_access: hasMarketplaceAccess,
      reasons,
    });
  }

  async grant(
    professionalId: string,
    input: GrantProfessionalSubscriptionInput,
  ): Promise<ProfessionalEntitlementSnapshot> {
    return this.transaction(async (client) => {
      const profRes = await client.query(
        `SELECT id, management_mode FROM professionals WHERE id = $1 FOR UPDATE`,
        [professionalId],
      );
      if (profRes.rows.length === 0) {
        throw new Error("professional_not_found");
      }

      const planRes = await client.query<PlanRow>(
        `SELECT id, code, name, is_active FROM subscription_plans WHERE code = $1`,
        [input.plan_code],
      );
      const plan = planRes.rows[0];
      if (!plan) {
        throw new Error("plan_not_found");
      }
      if (!plan.is_active) {
        throw new Error("plan_inactive");
      }

      const existingRes = await client.query<{
        id: string;
        starts_at: string;
        ends_at: string;
        revoked_at: string | null;
      }>(
        `SELECT id, starts_at::text, ends_at::text, revoked_at::text
         FROM professional_subscriptions
         WHERE professional_id = $1 FOR UPDATE`,
        [professionalId],
      );
      const existing = existingRes.rows[0];

      let subscriptionId: string;
      const prevStartsAt = existing ? new Date(existing.starts_at).toISOString() : null;
      const prevEndsAt = existing ? new Date(existing.ends_at).toISOString() : null;

      if (!existing) {
        const insertSub = await client.query<{ id: string }>(
          `INSERT INTO professional_subscriptions (professional_id, plan_id, starts_at, ends_at, revoked_at)
           VALUES ($1, $2, $3, $4, NULL)
           RETURNING id`,
          [professionalId, plan.id, input.starts_at, input.ends_at],
        );
        subscriptionId = insertSub.rows[0].id;
      } else {
        subscriptionId = existing.id;
        await client.query(
          `UPDATE professional_subscriptions
           SET plan_id = $2, starts_at = $3, ends_at = $4, revoked_at = NULL, updated_at = NOW()
           WHERE id = $1`,
          [subscriptionId, plan.id, input.starts_at, input.ends_at],
        );
      }

      await client.query(
        `INSERT INTO professional_subscription_events (
          subscription_id, professional_id, action, source,
          previous_starts_at, new_starts_at, previous_ends_at, new_ends_at
        ) VALUES ($1, $2, 'granted', 'internal_provisioning', $3, $4, $5, $6)`,
        [subscriptionId, professionalId, prevStartsAt, input.starts_at, prevEndsAt, input.ends_at],
      );

      return this.getEntitlementSnapshot(professionalId, client);
    });
  }

  async extend(
    professionalId: string,
    input: ExtendProfessionalSubscriptionInput,
  ): Promise<ProfessionalEntitlementSnapshot> {
    return this.transaction(async (client) => {
      const profRes = await client.query(
        `SELECT id FROM professionals WHERE id = $1 FOR UPDATE`,
        [professionalId],
      );
      if (profRes.rows.length === 0) {
        throw new Error("professional_not_found");
      }

      const existingRes = await client.query<{
        id: string;
        starts_at: string;
        ends_at: string;
        revoked_at: string | null;
      }>(
        `SELECT id, starts_at::text, ends_at::text, revoked_at::text
         FROM professional_subscriptions
         WHERE professional_id = $1 FOR UPDATE`,
        [professionalId],
      );
      const existing = existingRes.rows[0];
      if (!existing) {
        throw new Error("subscription_not_found");
      }

      const currentEndsAtTime = new Date(existing.ends_at).getTime();
      const newEndsAtTime = new Date(input.ends_at).getTime();
      if (newEndsAtTime <= currentEndsAtTime) {
        throw new Error("invalid_extension_period");
      }

      const prevStartsAt = new Date(existing.starts_at).toISOString();
      const prevEndsAt = new Date(existing.ends_at).toISOString();

      await client.query(
        `UPDATE professional_subscriptions
         SET ends_at = $2, updated_at = NOW()
         WHERE id = $1`,
        [existing.id, input.ends_at],
      );

      await client.query(
        `INSERT INTO professional_subscription_events (
          subscription_id, professional_id, action, source,
          previous_starts_at, new_starts_at, previous_ends_at, new_ends_at
        ) VALUES ($1, $2, 'extended', 'internal_provisioning', $3, $3, $4, $5)`,
        [existing.id, professionalId, prevStartsAt, prevEndsAt, input.ends_at],
      );

      return this.getEntitlementSnapshot(professionalId, client);
    });
  }

  async revoke(professionalId: string): Promise<ProfessionalEntitlementSnapshot> {
    return this.transaction(async (client) => {
      const profRes = await client.query(
        `SELECT id FROM professionals WHERE id = $1 FOR UPDATE`,
        [professionalId],
      );
      if (profRes.rows.length === 0) {
        throw new Error("professional_not_found");
      }

      const existingRes = await client.query<{
        id: string;
        starts_at: string;
        ends_at: string;
        revoked_at: string | null;
      }>(
        `SELECT id, starts_at::text, ends_at::text, revoked_at::text
         FROM professional_subscriptions
         WHERE professional_id = $1 FOR UPDATE`,
        [professionalId],
      );
      const existing = existingRes.rows[0];
      if (!existing) {
        throw new Error("subscription_not_found");
      }

      if (existing.revoked_at !== null) {
        return this.getEntitlementSnapshot(professionalId, client);
      }

      const startsAt = new Date(existing.starts_at).toISOString();
      const endsAt = new Date(existing.ends_at).toISOString();

      await client.query(
        `UPDATE professional_subscriptions
         SET revoked_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [existing.id],
      );

      await client.query(
        `INSERT INTO professional_subscription_events (
          subscription_id, professional_id, action, source,
          previous_starts_at, new_starts_at, previous_ends_at, new_ends_at
        ) VALUES ($1, $2, 'revoked', 'internal_provisioning', $3, $3, $4, $4)`,
        [existing.id, professionalId, startsAt, endsAt],
      );

      return this.getEntitlementSnapshot(professionalId, client);
    });
  }

  async reactivate(
    professionalId: string,
    input: ReactivateProfessionalSubscriptionInput,
  ): Promise<ProfessionalEntitlementSnapshot> {
    return this.transaction(async (client) => {
      const profRes = await client.query(
        `SELECT id FROM professionals WHERE id = $1 FOR UPDATE`,
        [professionalId],
      );
      if (profRes.rows.length === 0) {
        throw new Error("professional_not_found");
      }

      const existingRes = await client.query<{
        id: string;
        plan_id: string;
        starts_at: string;
        ends_at: string;
        revoked_at: string | null;
      }>(
        `SELECT id, plan_id, starts_at::text, ends_at::text, revoked_at::text
         FROM professional_subscriptions
         WHERE professional_id = $1 FOR UPDATE`,
        [professionalId],
      );
      const existing = existingRes.rows[0];
      if (!existing) {
        throw new Error("subscription_not_found");
      }

      let targetPlanId = existing.plan_id;
      if (input.plan_code) {
        const planRes = await client.query<PlanRow>(
          `SELECT id, code, name, is_active FROM subscription_plans WHERE code = $1`,
          [input.plan_code],
        );
        const plan = planRes.rows[0];
        if (!plan) throw new Error("plan_not_found");
        if (!plan.is_active) throw new Error("plan_inactive");
        targetPlanId = plan.id;
      }

      const prevStartsAt = new Date(existing.starts_at).toISOString();
      const prevEndsAt = new Date(existing.ends_at).toISOString();

      await client.query(
        `UPDATE professional_subscriptions
         SET plan_id = $2, starts_at = $3, ends_at = $4, revoked_at = NULL, updated_at = NOW()
         WHERE id = $1`,
        [existing.id, targetPlanId, input.starts_at, input.ends_at],
      );

      await client.query(
        `INSERT INTO professional_subscription_events (
          subscription_id, professional_id, action, source,
          previous_starts_at, new_starts_at, previous_ends_at, new_ends_at
        ) VALUES ($1, $2, 'reactivated', 'internal_provisioning', $3, $4, $5, $6)`,
        [existing.id, professionalId, prevStartsAt, input.starts_at, prevEndsAt, input.ends_at],
      );

      return this.getEntitlementSnapshot(professionalId, client);
    });
  }
}

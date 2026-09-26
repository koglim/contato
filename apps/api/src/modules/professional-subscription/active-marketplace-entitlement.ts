/**
 * SQL snippet to evaluate whether a professional has an active subscription
 * with an active plan providing the 'marketplace_access' entitlement.
 *
 * Requirements:
 * - professional_subscriptions exists for professional_id
 * - subscription_plans is active
 * - subscription_plan_entitlements has 'marketplace_access'
 * - starts_at <= NOW()
 * - ends_at > NOW()
 * - revoked_at IS NULL
 */
export function activeMarketplaceEntitlementSql(professionalAlias: string): string {
  return `EXISTS (
    SELECT 1
    FROM professional_subscriptions ps
    JOIN subscription_plans sp ON sp.id = ps.plan_id
    JOIN subscription_plan_entitlements spe ON spe.plan_id = sp.id
    WHERE ps.professional_id = ${professionalAlias}.id
      AND sp.is_active = TRUE
      AND spe.entitlement_key = 'marketplace_access'
      AND ps.starts_at <= NOW()
      AND ps.ends_at > NOW()
      AND ps.revoked_at IS NULL
  )`;
}

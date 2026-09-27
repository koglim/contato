import { eligibleManagedIdentitySql } from "../professional-eligibility/eligible-managed-identity.js";
import { activeMarketplaceEntitlementSql } from "./active-marketplace-entitlement.js";

/**
 * Central marketplace participation rule:
 * - legacy_unmanaged: exempt from account/identity/subscription requirements
 * - account_managed: requires eligible managed identity AND active marketplace entitlement
 */
export function marketplaceParticipationSql(professionalAlias = "professionals"): string {
  return `(
    ${professionalAlias}.management_mode = 'legacy_unmanaged'
    OR (
      ${professionalAlias}.management_mode = 'account_managed'
      AND ${eligibleManagedIdentitySql(professionalAlias)}
      AND ${activeMarketplaceEntitlementSql(professionalAlias)}
    )
  )`;
}

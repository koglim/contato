export function eligibleManagedIdentitySql(professionalAlias = "professionals"): string {
  return `EXISTS (
    SELECT 1
      FROM professional_memberships m
      JOIN accounts a ON a.id = m.account_id
      JOIN account_identifiers i ON i.account_id = a.id AND i.verified_at IS NOT NULL
     WHERE m.professional_id = ${professionalAlias}.id
       AND m.status = 'active'
       AND a.status = 'active'
  )`;
}

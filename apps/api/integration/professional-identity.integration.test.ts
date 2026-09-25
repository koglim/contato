import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { closeDatabaseConnection, inDatabaseTransaction, query, withTransaction } from "../src/database/connection.js";
import { PostgresAccountIdentityRepository } from "../src/modules/account-identity/account-identity.repository.js";
import { PostgresProfessionalAccessRepository } from "../src/modules/professional-access/professional-access.repository.js";
import { ProfessionalAccessService } from "../src/modules/professional-access/professional-access.service.js";
import { rollbackThrough } from "./rollback-helper.js";

after(closeDatabaseConnection);

async function rolledBack(operation: () => Promise<void>) {
  const marker = new Error("identity_test_rollback");
  try {
    await withTransaction(client => inDatabaseTransaction(client, async () => { await operation(); throw marker; }));
  } catch (error) {
    if (error !== marker) throw error;
  }
}

async function createProfessional(phone = "+5566900000000") {
  const id = randomUUID();
  await query(`INSERT INTO professionals(id, display_name, slug, phone_e164)
    VALUES ($1, 'Identity fixture', $2, $3)`, [id, `identity-${id}`, phone]);
  return id;
}

const isForeignKeyError = (error: unknown) => (error as { code?: string }).code === "23503";
const isDuplicateError = (error: unknown) => (error as { code?: string }).code === "23505";

test("professional access requires verified identity and the exact active membership", async () => {
  await rolledBack(async () => {
    const identities = new PostgresAccountIdentityRepository();
    const memberships = new PostgresProfessionalAccessRepository();
    const access = new ProfessionalAccessService(memberships);
    const accountId = (await identities.createAccount()).id;
    const professionalId = await createProfessional("+5566999999999");
    const otherProfessionalId = await createProfessional();
    const input = { accountId, professionalId };
    assert.deepEqual(await access.resolveProfessionalAccess(input), { status: "not_member" },
      "profile phone alone cannot confer ownership");

    const identifier = await identities.addIdentifier({ accountId, kind: "phone", value: " +5566999999999 " });
    assert.equal((await query("SELECT normalized_value, verified_at FROM account_identifiers WHERE id=$1", [identifier.id])).rows[0].normalized_value, "+5566999999999");
    assert.equal((await query("SELECT verified_at FROM account_identifiers WHERE id=$1", [identifier.id])).rows[0].verified_at, null);
    await memberships.createMembership({ accountId, professionalId, role: "owner" });
    assert.deepEqual(await access.resolveProfessionalAccess(input), { status: "identity_unverified" });
    assert.deepEqual(await access.resolveProfessionalAccess({ accountId, professionalId: otherProfessionalId }), { status: "not_member" });
    assert.deepEqual(await access.resolveProfessionalAccess({ accountId, professionalId: randomUUID() }), { status: "not_found" });

    await query("UPDATE account_identifiers SET verified_at=NOW() WHERE id=$1", [identifier.id]);
    assert.deepEqual(await access.resolveProfessionalAccess(input), { status: "authorized" });
    await query("UPDATE professional_memberships SET role='admin' WHERE account_id=$1 AND professional_id=$2", [accountId, professionalId]);
    assert.deepEqual(await access.resolveProfessionalAccess(input), { status: "authorized" });
    await query("UPDATE accounts SET status='blocked' WHERE id=$1", [accountId]);
    assert.deepEqual(await access.resolveProfessionalAccess(input), { status: "account_blocked" });
    await query("UPDATE accounts SET status='active' WHERE id=$1", [accountId]);
    assert.equal(await memberships.revokeMembership(input), true);
    assert.deepEqual(await access.resolveProfessionalAccess(input), { status: "membership_revoked" });

    const events = (await query<{ action: string; previous_role: string | null; new_role: string; previous_status: string | null; new_status: string }>(
      "SELECT action, previous_role, new_role, previous_status, new_status FROM professional_membership_events WHERE account_id=$1 ORDER BY created_at, id", [accountId])).rows;
    assert.equal(events.length, 3);
    assert.deepEqual(new Set(events.map(item => `${item.action}:${item.previous_status ?? "null"}:${item.new_status}`)),
      new Set(["created:null:active", "changed:active:active", "changed:active:revoked"]));
    assert.deepEqual(new Set(events.map(item => `${item.previous_role ?? "null"}:${item.new_role}`)),
      new Set(["null:owner", "owner:admin", "admin:admin"]));
    await assert.rejects(query("UPDATE professional_membership_events SET action='changed' WHERE account_id=$1", [accountId]),
      error => (error as { code?: string }).code === "P0021");
  });
});

test("identity foreign keys reject nonexistent accounts and professionals", async () => {
  await rolledBack(async () => {
    await assert.rejects(query(`INSERT INTO account_identifiers(account_id, kind, normalized_value)
      VALUES ($1, 'phone', '+5566999999999')`, [randomUUID()]), isForeignKeyError);
  });
  await rolledBack(async () => {
    const accountId = (await new PostgresAccountIdentityRepository().createAccount()).id;
    await assert.rejects(query(`INSERT INTO professional_memberships(account_id, professional_id, role)
      VALUES ($1, $2, 'owner')`, [accountId, randomUUID()]), isForeignKeyError);
  });
  await rolledBack(async () => {
    const professionalId = await createProfessional();
    await assert.rejects(query(`INSERT INTO professional_memberships(account_id, professional_id, role)
      VALUES ($1, $2, 'owner')`, [randomUUID(), professionalId]), isForeignKeyError);
  });
});

test("membership and audit evidence cannot be deleted or truncated", async () => {
  await rolledBack(async () => {
    const accountId = (await new PostgresAccountIdentityRepository().createAccount()).id;
    const professionalId = await createProfessional();
    await new PostgresProfessionalAccessRepository().createMembership({ accountId, professionalId, role: "owner" });
    await assert.rejects(query("DELETE FROM professional_memberships WHERE account_id=$1 AND professional_id=$2", [accountId, professionalId]),
      error => (error as { code?: string }).code === "P0021");
  });
  await rolledBack(async () => {
    await assert.rejects(query("TRUNCATE professional_membership_events"),
      error => (error as { code?: string }).code === "P0021");
  });
});

test("phone and email identifiers are globally unique after normalization", async () => {
  const identities = new PostgresAccountIdentityRepository();
  const accountIds: string[] = [];
  try {
    accountIds.push((await identities.createAccount()).id, (await identities.createAccount()).id);
    const [first, second] = accountIds as [string, string];
    const phone = `+55${randomUUID().replace(/\D/gu, "").padEnd(11, "7").slice(0, 11)}`;
    await identities.addIdentifier({ accountId: first, kind: "phone", value: ` ${phone} ` });
    await assert.rejects(identities.addIdentifier({ accountId: second, kind: "phone", value: phone }), isDuplicateError);
    const email = `owner-${randomUUID()}@example.com`;
    await identities.addIdentifier({ accountId: first, kind: "email", value: email.toUpperCase() });
    await assert.rejects(identities.addIdentifier({ accountId: second, kind: "email", value: email }), isDuplicateError);
    assert.equal((await query("SELECT COUNT(*)::int AS count FROM account_identifiers WHERE account_id=ANY($1::uuid[])", [accountIds])).rows[0].count, 2);
    await assert.rejects(query(`INSERT INTO account_identifiers(account_id, kind, normalized_value)
      VALUES ($1, 'phone', '5566999999999')`, [second]));
    await assert.rejects(query(`INSERT INTO account_identifiers(account_id, kind, normalized_value)
      VALUES ($1, 'email', 'OWNER@EXAMPLE.COM')`, [second]));
  } finally {
    await query("DELETE FROM account_identifiers WHERE account_id=ANY($1::uuid[])", [accountIds]);
    await query("DELETE FROM accounts WHERE id=ANY($1::uuid[])", [accountIds]);
  }
});

test("concurrent identifier creation cannot produce two valid owners of one value", async () => {
  const identities = new PostgresAccountIdentityRepository();
  const accountIds: string[] = [];
  try {
    accountIds.push((await identities.createAccount()).id, (await identities.createAccount()).id);
    const value = `team-${randomUUID()}@example.com`;
    const results = await Promise.allSettled(accountIds.map(accountId => identities.addIdentifier({ accountId, kind: "email", value })));
    assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
    assert.equal(results.filter(item => item.status === "rejected" && isDuplicateError(item.reason)).length, 1);
    assert.equal((await query("SELECT COUNT(*)::int AS count FROM account_identifiers WHERE kind='email' AND normalized_value=$1", [value])).rows[0].count, 1);
  } finally {
    await query("DELETE FROM account_identifiers WHERE account_id=ANY($1::uuid[])", [accountIds]);
    await query("DELETE FROM accounts WHERE id=ANY($1::uuid[])", [accountIds]);
  }
});

test("migration 021 blocks destructive down and preserves committed identity data", async () => {
  const accountId = (await new PostgresAccountIdentityRepository().createAccount()).id;
  try {
    await assert.rejects(rollbackThrough("021_add_professional_identity_foundation"), error =>
      /PROFESSIONAL_IDENTITY_ROLLBACK_BLOCKED|P0021/u.test(String((error as { stderr?: string }).stderr)));
    assert.equal((await query("SELECT COUNT(*)::int AS count FROM accounts WHERE id=$1", [accountId])).rows[0].count, 1);
    assert.equal((await query("SELECT COUNT(*)::int AS count FROM pgmigrations WHERE name='021_add_professional_identity_foundation'")).rows[0].count, 1);
  } finally {
    await query("DELETE FROM accounts WHERE id=$1", [accountId]);
  }
});

test("migration 021 compatible down and reapply preserve earlier professional data", async () => {
  const professionalId = await createProfessional();
  let rolledBack = false;
  try {
    await rollbackThrough("021_add_professional_identity_foundation");
    rolledBack = true;
    assert.equal((await query("SELECT to_regclass('accounts') AS value")).rows[0].value, null);
    assert.equal((await query("SELECT to_regclass('account_identifiers') AS value")).rows[0].value, null);
    assert.equal((await query("SELECT to_regclass('professional_memberships') AS value")).rows[0].value, null);
    assert.equal((await query("SELECT COUNT(*)::int AS count FROM professionals WHERE id=$1", [professionalId])).rows[0].count, 1);
  } finally {
    if (rolledBack) await promisify(execFile)(process.execPath, [
      "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "-m", "database/migrations",
      "--database-url-var", "DATABASE_URL", "up",
    ], { cwd: fileURLToPath(new URL("../../../", import.meta.url)) });
    await query("DELETE FROM professionals WHERE id=$1", [professionalId]);
  }
  assert.equal((await query("SELECT COUNT(*)::int AS count FROM pgmigrations WHERE name='021_add_professional_identity_foundation'")).rows[0].count, 1);
});

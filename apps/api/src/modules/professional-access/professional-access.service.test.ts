import assert from "node:assert/strict";
import test from "node:test";
import { ProfessionalAccessService } from "./professional-access.service.js";
import type { ProfessionalAccessReader, ProfessionalAccessSnapshot } from "./professional-access.types.js";

const input = { accountId: "00000000-0000-4000-8000-000000000001", professionalId: "00000000-0000-4000-8000-000000000002" };
const active: ProfessionalAccessSnapshot = { accountStatus: "active", professionalExists: true,
  membershipStatus: "active", membershipRole: "owner", hasVerifiedIdentifier: true };

test("professional access requires account, membership and verified identity; blocked and revoked deny", async () => {
  for (const [state, expected] of [
    [active, "authorized"],
    [{ ...active, accountStatus: null }, "not_found"],
    [{ ...active, professionalExists: false }, "not_found"],
    [{ ...active, accountStatus: "blocked" }, "account_blocked"],
    [{ ...active, membershipStatus: null }, "not_member"],
    [{ ...active, membershipStatus: "revoked" }, "membership_revoked"],
    [{ ...active, hasVerifiedIdentifier: false }, "identity_unverified"],
  ] as const) {
    const repository: ProfessionalAccessReader = { async findSnapshot() { return state as ProfessionalAccessSnapshot; } };
    const result = await new ProfessionalAccessService(repository).resolveProfessionalAccess(input);
    assert.deepEqual(result, expected === "authorized" ? { status: expected, role: "owner" } : { status: expected });
  }
});

test("professional access rejects untrusted identifier shapes before repository access", async () => {
  const repository: ProfessionalAccessReader = { async findSnapshot() { throw new Error("should not run"); } };
  const service = new ProfessionalAccessService(repository);
  await assert.rejects(service.resolveProfessionalAccess({ ...input, professionalId: "not-a-uuid" }));
  await assert.rejects(service.resolveProfessionalAccess({ ...input, extra: "browser-choice" } as never));
});

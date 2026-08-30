import assert from "node:assert/strict";
import test from "node:test";
import { upsertArea, upsertService } from "./state";

test("upsertService replaces a reactivated service instead of duplicating it", () => {
  const existing = { id: "service-1", is_active: false } as never;
  const reactivated = { id: "service-1", is_active: true } as never;
  assert.deepEqual(upsertService([existing], reactivated), [reactivated]);
});

test("upsertArea clears any previous local primary area", () => {
  const prior = { id: "area-1", is_primary: true } as never;
  const newPrimary = { id: "area-2", is_primary: true } as never;
  assert.deepEqual(upsertArea([prior], newPrimary), [{ id: "area-1", is_primary: false }, newPrimary]);
});

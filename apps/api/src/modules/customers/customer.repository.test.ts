import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";
import { PostgresCustomerRepository, type CustomerQuery } from "./customer.repository.js";

test("customer repository atomically finds or creates by canonical phone", async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const execute: CustomerQuery = async <T extends QueryResultRow>(text: string, values = []) => {
    calls.push({ text, values });
    return { rows: [{ id: "11111111-1111-4111-8111-111111111111" }] as T[] };
  };
  const repository = new PostgresCustomerRepository(execute);
  const first = await repository.findOrCreateByPhoneE164("+5566999999999");
  const second = await repository.findOrCreateByPhoneE164("+5566999999999");
  assert.equal(first.id, second.id);
  assert.match(calls[0]!.text, /ON CONFLICT \(phone_e164\)/u);
  assert.deepEqual(calls[0]!.values, ["+5566999999999"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";
import { PostgresCustomerRepository, type CustomerQuery } from "./customer.repository.js";

test("customer repository creates new customer with canonical phone when not found", async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const execute: CustomerQuery = async <T extends QueryResultRow>(text: string, values = []) => {
    calls.push({ text, values });
    if (text.includes("SELECT id, phone_e164 FROM customers")) {
      return { rows: [] as T[] };
    }
    return { rows: [{ id: "11111111-1111-4111-8111-111111111111" }] as T[] };
  };
  const repository = new PostgresCustomerRepository(execute);
  const result = await repository.findOrCreateByPhoneE164("+559984119070");
  assert.equal(result.id, "11111111-1111-4111-8111-111111111111");
  assert.match(calls[0]!.text, /SELECT id, phone_e164 FROM customers WHERE phone_e164 = ANY\(\$1\) FOR UPDATE/u);
  assert.deepEqual(calls[0]!.values, [["+5599984119070", "+559984119070"]]);
  assert.match(calls[1]!.text, /INSERT INTO customers \(phone_e164\)/u);
  assert.deepEqual(calls[1]!.values, ["+5599984119070"]);
});

test("customer repository updates degraded phone to canonical and preserves customer id", async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const execute: CustomerQuery = async <T extends QueryResultRow>(text: string, values = []) => {
    calls.push({ text, values });
    if (text.includes("SELECT id, phone_e164 FROM customers")) {
      return { rows: [{ id: "22222222-2222-4222-8222-222222222222", phone_e164: "+559984119070" }] as T[] };
    }
    return { rows: [] as T[] };
  };
  const repository = new PostgresCustomerRepository(execute);
  const result = await repository.findOrCreateByPhoneE164("+5599984119070");
  assert.equal(result.id, "22222222-2222-4222-8222-222222222222");
  assert.match(calls[1]!.text, /UPDATE customers SET phone_e164 = \$1 WHERE id = \$2/u);
  assert.deepEqual(calls[1]!.values, ["+5599984119070", "22222222-2222-4222-8222-222222222222"]);
});

test("customer repository throws CUSTOMER_PHONE_IDENTITY_COLLISION when both canonical and degraded rows exist", async () => {
  const execute: CustomerQuery = async <T extends QueryResultRow>(text: string) => {
    if (text.includes("SELECT id, phone_e164 FROM customers")) {
      return {
        rows: [
          { id: "11111111-1111-4111-8111-111111111111", phone_e164: "+5599984119070" },
          { id: "22222222-2222-4222-8222-222222222222", phone_e164: "+559984119070" },
        ] as T[],
      };
    }
    return { rows: [] as T[] };
  };
  const repository = new PostgresCustomerRepository(execute);
  await assert.rejects(
    repository.findOrCreateByPhoneE164("+5599984119070"),
    /CUSTOMER_PHONE_IDENTITY_COLLISION/u,
  );
});

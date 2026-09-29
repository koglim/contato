import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";
import {
  PostgresCustomerRepository,
  CustomerPhoneIdentityCollisionError,
  type CustomerQuery,
} from "./customer.repository.js";
import { inDatabaseTransaction, type DatabaseClient } from "../../database/connection.js";

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

test("customer repository throws CustomerPhoneIdentityCollisionError when both canonical and degraded rows exist", async () => {
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
    (err: unknown) => {
      assert.ok(err instanceof CustomerPhoneIdentityCollisionError);
      assert.equal(err.code, "customer_phone_identity_collision");
      return true;
    }
  );
});

test("customer repository executes inside transaction runner when execute is omitted", async () => {
  let transactionCalled = false;
  const fakeDb: DatabaseClient = {
    query: async <T extends QueryResultRow>(text: string) => {
      if (text.includes("SELECT id, phone_e164 FROM customers")) {
        return { rows: [{ id: "33333333-3333-4333-8333-333333333333", phone_e164: "+559984119070" }] as T[] };
      }
      return { rows: [] as T[] };
    },
  };
  const fakeTransaction = async <T>(cb: (client: DatabaseClient) => Promise<T>): Promise<T> => {
    transactionCalled = true;
    return cb(fakeDb);
  };
  const repository = new PostgresCustomerRepository(undefined, fakeTransaction);
  const result = await repository.findOrCreateByPhoneE164("+5599984119070");
  assert.equal(result.id, "33333333-3333-4333-8333-333333333333");
  assert.equal(transactionCalled, true);
});

test("customer repository reuses active inDatabaseTransaction scope without opening new connection", async () => {
  const queryLogs: string[] = [];
  const sharedClient: DatabaseClient = {
    query: async <T extends QueryResultRow>(text: string) => {
      queryLogs.push(text);
      if (text.includes("SELECT id, phone_e164 FROM customers")) {
        return { rows: [{ id: "44444444-4444-4444-8444-444444444444", phone_e164: "+559984119070" }] as T[] };
      }
      return { rows: [] as T[] };
    },
  };

  const repository = new PostgresCustomerRepository();
  const result = await inDatabaseTransaction(sharedClient, async () => {
    return repository.findOrCreateByPhoneE164("+5599984119070");
  });

  assert.equal(result.id, "44444444-4444-4444-8444-444444444444");
  assert.ok(queryLogs.length >= 2, "queries must execute on shared client");
  assert.ok(queryLogs.some((q) => q.includes("SELECT id, phone_e164 FROM customers")));
  assert.ok(queryLogs.some((q) => q.includes("UPDATE customers SET phone_e164")));
});

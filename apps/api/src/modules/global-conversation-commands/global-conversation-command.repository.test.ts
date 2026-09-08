import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { QueryResultRow } from "pg";
import {
  PostgresGlobalConversationCommandRepository,
  type GlobalConversationCommandQuery,
} from "./global-conversation-command.repository.js";

const customerId = randomUUID();
const conversationId = randomUUID();

function fakeDatabase(results: QueryResultRow[][]) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const execute: GlobalConversationCommandQuery = async <T extends QueryResultRow>(text: string, values = []) => {
    calls.push({ text, values });
    return { rows: (results.shift() ?? []) as T[] };
  };
  return { calls, repository: new PostgresGlobalConversationCommandRepository(execute) };
}

test("global command repository reads an active conversation in every pending slot", async () => {
  for (const pendingSlot of ["location", "service", "selection"] as const) {
    const context = fakeDatabase([[{ id: conversationId, pending_slot: pendingSlot }]]);
    assert.deepEqual(await context.repository.findActiveByCustomerId(customerId), {
      id: conversationId,
      pendingSlot,
    });
    assert.match(context.calls[0]!.text, /status = 'active'/u);
    assert.match(context.calls[0]!.text, /pending_slot IS NOT NULL/u);
    assert.match(context.calls[0]!.text, /expires_at > NOW\(\)/u);
    assert.deepEqual(context.calls[0]!.values, [customerId]);
  }
});

test("global command repository atomically cancels active conversations and clears leases", async () => {
  for (const pendingSlot of ["location", "service", "selection"] as const) {
    const context = fakeDatabase([[{ id: conversationId, pending_slot: pendingSlot }]]);
    assert.deepEqual(await context.repository.cancelActiveByCustomerId(customerId), {
      id: conversationId,
      pendingSlot,
    });
    const statement = context.calls[0]!.text;
    assert.match(statement, /WITH active_conversation/u);
    assert.match(statement, /FOR UPDATE/u);
    assert.match(statement, /SET status = 'cancelled'/u);
    assert.match(statement, /pending_slot = NULL/u);
    assert.match(statement, /processing_token = NULL/u);
    assert.match(statement, /processing_started_at = NULL/u);
    assert.match(statement, /status = 'active'/u);
    assert.doesNotMatch(statement, /DELETE|search_request_id = NULL/u);
    assert.deepEqual(context.calls[0]!.values, [customerId]);
  }
});

test("global command repository returns null when no active conversation can be cancelled", async () => {
  const context = fakeDatabase([[]]);
  assert.equal(await context.repository.cancelActiveByCustomerId(customerId), null);
  assert.equal(context.calls.length, 1);
});

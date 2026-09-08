import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { DefaultGlobalConversationCommandService } from "./global-conversation-command.service.js";
import type {
  ActiveGlobalConversation,
  GlobalConversationCommandRepository,
} from "./global-conversation-command.types.js";

const customerId = randomUUID();
const initialActiveConversation: ActiveGlobalConversation = { id: randomUUID(), pendingSlot: "selection" };

class FakeGlobalConversationCommandRepository implements GlobalConversationCommandRepository {
  active: ActiveGlobalConversation | null = initialActiveConversation;
  reads = 0;
  cancellations = 0;

  async findActiveByCustomerId() {
    this.reads += 1;
    return this.active;
  }

  async cancelActiveByCustomerId() {
    this.cancellations += 1;
    const cancelled = this.active;
    this.active = null;
    return cancelled;
  }
}

function context() {
  const repository = new FakeGlobalConversationCommandRepository();
  return { repository, service: new DefaultGlobalConversationCommandService(repository) };
}

test("global command service cancels active location, service and selection conversations", async () => {
  for (const pendingSlot of ["location", "service", "selection"] as const) {
    const current = context();
    current.repository.active = { id: randomUUID(), pendingSlot };
    assert.deepEqual(await current.service.execute({ customerId, command: { kind: "cancel" } }), { kind: "cancelled" });
    assert.equal(current.repository.cancellations, 1);
    assert.equal(current.repository.reads, 0);
  }
});

test("global command service makes cancel idempotent when no conversation is active", async () => {
  const current = context();
  assert.deepEqual(await current.service.execute({ customerId, command: { kind: "cancel" } }), { kind: "cancelled" });
  assert.deepEqual(await current.service.execute({ customerId, command: { kind: "cancel" } }), { kind: "no_active_conversation" });
  assert.equal(current.repository.cancellations, 2);
});

test("global command service restarts without creating conversations or searches", async () => {
  const current = context();
  assert.deepEqual(await current.service.execute({ customerId, command: { kind: "restart" } }), { kind: "restarted" });
  assert.deepEqual(await current.service.execute({ customerId, command: { kind: "restart" } }), { kind: "restarted" });
  assert.equal(current.repository.cancellations, 2);
  assert.equal(current.repository.reads, 0);
  assert.equal(current.repository.active, null);
});

test("global command service provides help without writes for active and inactive conversations", async () => {
  for (const pendingSlot of ["location", "service", "selection", null] as const) {
    const current = context();
    current.repository.active = pendingSlot === null ? null : { id: randomUUID(), pendingSlot };
    assert.deepEqual(await current.service.execute({ customerId, command: { kind: "help" } }), {
      kind: "help",
      pendingSlot,
    });
    assert.equal(current.repository.reads, 1);
    assert.equal(current.repository.cancellations, 0);
  }
});

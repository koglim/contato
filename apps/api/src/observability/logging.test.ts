import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../app.js";

test("actual API logs omit database/provider details, request query, headers, IP and payload", async () => {
  let output = "";
  const secret = "private-log-canary";
  const error = Object.assign(new Error(`connection ${secret}`), {
    code: "23505", detail: `phone ${secret}`, query: `SELECT '${secret}'`, cause: new Error(secret),
  });
  const app = buildApp({
    logStream: { write: (line) => { output += line; } },
    checkDatabase: async () => { throw error; },
  });
  try {
    await app.inject({ method: "GET", url: `/health/db?token=${secret}`, headers: { authorization: secret, "x-internal-key": secret, "x-request-id": secret } });
    await app.inject({ method: "POST", url: `/missing/${secret}?query=${secret}`, headers: { cookie: secret }, payload: { raw_text: secret } });
    app.log.error(error);
    app.log.error({ err: error }, error.message);
    app.log.info({ raw_text: secret, processing_token: secret, phone_e164: secret, body: { secret } }, "Allowed event");
    assert.equal(output.includes(secret), false);
    assert.doesNotMatch(output, /remoteAddress|remotePort|authorization|x-internal-key|cookie|SELECT/u);
    const events = output.trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(events.some((event) => event.err?.code === "23505"));
    assert.ok(events.some((event) => event.code === "http_request_completed" && event.route === "/health/db" && event.status_code === 503));
    assert.ok(events.some((event) => event.code === "http_request_completed" && event.status_code === 404 && typeof event.duration_ms === "number"));
  } finally { await app.close(); }
});

test("unknown error codes and uncaught route failures retain safe diagnostics only", async () => {
  let output = "";
  const app = buildApp({ logStream: { write: (line) => { output += line; } } });
  app.get("/diagnostic-test", async () => { throw Object.assign(new Error("private-error-text"), { code: "private-error-code" }); });
  try {
    assert.equal((await app.inject({ method: "GET", url: "/diagnostic-test" })).statusCode, 500);
    assert.equal(output.includes("private-error"), false);
    assert.ok(output.includes("internal_error"));
  } finally { await app.close(); }
});

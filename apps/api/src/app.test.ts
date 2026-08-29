import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "./app.js";

test("GET /health returns the service status", async () => {
  const app = buildApp();
  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });

  await app.close();
});

test("GET /health/db reports a connected database", async () => {
  const app = buildApp({ checkDatabase: async () => undefined });
  const response = await app.inject({ method: "GET", url: "/health/db" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok", database: "connected" });

  await app.close();
});

test("GET /health/db does not expose database errors", async () => {
  const app = buildApp({ checkDatabase: async () => Promise.reject(new Error("connection failed")) });
  const response = await app.inject({ method: "GET", url: "/health/db" });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { status: "error", database: "unavailable" });

  await app.close();
});

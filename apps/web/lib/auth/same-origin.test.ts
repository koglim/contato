import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sameOriginError } from "./same-origin";

test("same-origin helper accepts the exact origin and rejects absent or foreign origins", async () => {
  const previous = process.env.PROFESSIONAL_AUTH_ENABLED;
  process.env.PROFESSIONAL_AUTH_ENABLED = "true";
  try {
    assert.equal(sameOriginError(new Request("https://dashboard.example/api/dashboard", { headers: { origin: "https://dashboard.example" } })), null);
    assert.equal(sameOriginError(new Request("https://dashboard.example/api/dashboard"))?.status, 403);
    assert.equal(sameOriginError(new Request("https://dashboard.example/api/dashboard", { headers: { origin: "https://evil.example" } }))?.status, 403);
  } finally {
    process.env.PROFESSIONAL_AUTH_ENABLED = previous;
  }
});

test("demo mode preserves the existing mutation flow", () => {
  const previous = process.env.PROFESSIONAL_AUTH_ENABLED;
  process.env.PROFESSIONAL_AUTH_ENABLED = "false";
  try {
    assert.equal(sameOriginError(new Request("https://dashboard.example/api/dashboard")), null);
  } finally {
    process.env.PROFESSIONAL_AUTH_ENABLED = previous;
  }
});

test("every state-changing dashboard BFF route uses the centralized same-origin guard", () => {
  for (const path of [
    "app/api/dashboard/access/route.ts",
    "app/api/dashboard/logout/route.ts",
    "app/api/dashboard/profile/route.ts",
    "app/api/dashboard/route.ts",
    "app/api/dashboard/onboarding/route.ts",
    "app/api/dashboard/claim/route.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /sameOriginError\(request\)/u, path);
  }
});

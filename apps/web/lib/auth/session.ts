import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const tokenPattern = /^exp:(\d+)$/;
export const dashboardSessionDurationSeconds = 60 * 60 * 12;

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createDashboardSession(secret: string, now = Date.now(), durationSeconds = dashboardSessionDurationSeconds) {
  const payload = Buffer.from(`exp:${Math.floor(now / 1000) + durationSeconds}`).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function isDashboardSessionValid(token: string | undefined, secret: string | undefined, now = Date.now()) {
  if (!token || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;

  const expectedSignature = sign(parts[0], secret);
  const given = Buffer.from(parts[1], "base64url");
  const expected = Buffer.from(expectedSignature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;

  const payload = Buffer.from(parts[0], "base64url").toString("utf8");
  const match = tokenPattern.exec(payload);
  return Boolean(match && Number(match[1]) > Math.floor(now / 1000));
}

export function hasMatchingDemoPassword(password: unknown, expected: string | undefined) {
  if (typeof password !== "string" || !expected) return false;
  const candidate = createHash("sha256").update(password).digest();
  const configured = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidate, configured);
}

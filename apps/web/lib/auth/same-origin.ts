export function sameOriginError(request: Request) {
  if (process.env.PROFESSIONAL_AUTH_ENABLED !== "true") return null;
  const origin = request.headers.get("origin");
  let expected: string;
  try { expected = new URL(request.url).origin; }
  catch { return Response.json({ error: "invalid_origin" }, { status: 403 }); }
  return origin === expected ? null : Response.json({ error: "invalid_origin" }, { status: 403 });
}

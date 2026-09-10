import type { FastifyServerOptions } from "fastify";

export type LogStream = { write(message: string): void };
const safeCodes = new Set(["23503", "23505", "23514", "40001", "40P01", "57014", "53300", "57P01", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"]);

export function apiLoggerOptions(stream?: LogStream): Exclude<FastifyServerOptions["logger"], boolean | undefined> {
  return {
    ...(stream ? { stream } : {}),
    serializers: {
      req: (request) => ({ method: request?.method }),
      res: (reply) => ({ statusCode: reply?.statusCode }),
      err: (error) => {
        const code: unknown = error && Object.getOwnPropertyDescriptor(error, "code")?.value;
        return { type: "Error", message: "[redacted]", stack: "", code: typeof code === "string" && safeCodes.has(code) ? code : "internal_error" };
      },
    },
    hooks: {
      logMethod(args, method) {
        const first: unknown = args[0];
        // Pino also copies Error.message to msg; an err serializer alone is
        // insufficient. Keep a stable message for all error-object log calls.
        if (first instanceof Error) return method.call(this, { err: first }, "Operation failed");
        if (first && typeof first === "object" && "err" in first) return method.call(this, first, "Operation failed");
        return method.apply(this, args);
      },
    },
    redact: {
      paths: ["headers", "body", "password", "raw_text", "text_content", "phone_e164", "recipient_phone_e164", "processing_token",
        'audio_base64','media_bytes','transcript','*.audio_base64','*.media_bytes','*.transcript',
        "*.password", "*.raw_text", "*.text_content", "*.phone_e164", "*.recipient_phone_e164", "*.processing_token"],
      remove: true,
    },
  };
}

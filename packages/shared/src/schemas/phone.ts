import { z } from "zod";

export const phoneE164Schema = z.string().regex(
  /^\+[1-9]\d{1,14}$/u,
  "phone_e164 must be a canonical E.164 number",
);

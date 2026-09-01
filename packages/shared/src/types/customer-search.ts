import type { z } from "zod";
import type {
  customerSearchMessageRequestSchema,
  customerSearchMessageResponseSchema,
} from "../schemas/customer-search.js";

export type CustomerSearchMessageInput = z.infer<typeof customerSearchMessageRequestSchema>;
export type CustomerSearchMessageResponse = z.infer<typeof customerSearchMessageResponseSchema>;

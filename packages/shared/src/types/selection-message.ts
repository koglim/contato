import type { z } from "zod";
import type { selectionMessageContractSchema } from "../schemas/selection-message.js";

export type SelectionMessageContract = z.infer<typeof selectionMessageContractSchema>;

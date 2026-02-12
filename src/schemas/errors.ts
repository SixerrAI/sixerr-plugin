// SOURCE OF TRUTH: switchboard-server/src/schemas/errors.ts

import { z } from "zod";

export const SwitchboardErrorSchema = z.strictObject({
  error: z.strictObject({
    message: z.string(),
    type: z.string(),
    code: z.string().optional(),
  }),
});

export type SwitchboardError = z.infer<typeof SwitchboardErrorSchema>;

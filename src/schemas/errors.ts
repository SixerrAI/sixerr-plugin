// SOURCE OF TRUTH: sixerr-server/src/schemas/errors.ts

import { z } from "zod";

export const SixerrErrorSchema = z.strictObject({
  error: z.strictObject({
    message: z.string(),
    type: z.string(),
    code: z.string().optional(),
  }),
});

export type SixerrError = z.infer<typeof SixerrErrorSchema>;

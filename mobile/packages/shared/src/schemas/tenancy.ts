// packages/shared/src/schemas/tenancy.ts
// Client-safe signup validator mirrored from fleet-management/packages/shared/src/schemas/tenancy.ts.
// The tenant is always derived from the authenticated Principal (JWT tid) server-side, never the body.
import { z } from 'zod';

export const SignupSchema = z.object({
  company_name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  password: z.string().min(12).max(200),
  full_name: z.string().min(1).max(200).optional(),
});
export type SignupInput = z.infer<typeof SignupSchema>;

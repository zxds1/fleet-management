// packages/api/src/http/validate.ts
// zod validation at the router edge (03 §1 step 1). Failure → 400 VALIDATION_ERROR carrying
// field_errors (01 §11).

import type { Request } from "express";
import { ValidationError, type FieldError } from "@fleet/shared";
import type { z } from "zod";

export function parseBody<S extends z.ZodTypeAny>(schema: S, req: Request): z.infer<S> {
  return parse(schema, req.body);
}

export function parseQuery<S extends z.ZodTypeAny>(schema: S, req: Request): z.infer<S> {
  return parse(schema, req.query);
}

export function parseParams<S extends z.ZodTypeAny>(schema: S, req: Request): z.infer<S> {
  return parse(schema, req.params);
}

export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ValidationError("Request failed validation", toFieldErrors(result.error));
}

function toFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "(body)",
    code: issue.code.toUpperCase(),
    message: issue.message,
  }));
}

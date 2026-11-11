import { Types } from 'mongoose';
import { z } from 'zod';
import { badRequest } from './httpError.js';

/** Parse untrusted input; throws a 400 with field-level details on failure. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest(
      'Validation failed',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

export const objectId = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v) && /^[a-f\d]{24}$/i.test(v), 'Invalid id')
  .transform((v) => new Types.ObjectId(v));

export const idParams = z.object({ id: objectId });

export const email = z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254));
export const password = z.string().min(8, 'Password must be at least 8 characters').max(72);
export const name = z.string().trim().min(1).max(100);
export const interests = z
  .array(z.string().trim().toLowerCase().min(1).max(50))
  .max(20)
  .transform((arr) => [...new Set(arr)]);

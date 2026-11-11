import { config } from 'dotenv';
import { z } from 'zod';

config({ quiet: true });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('1d'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  throw new Error(`Invalid environment configuration: ${issues}`);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';

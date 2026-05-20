import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  JWT_SECRET: z.string().min(24),
  ACCESS_KEY: z.string().optional(),
  DEFAULT_SESSION_NAME: z.string().default("Internal Chat"),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
  MESSAGE_RATE_LIMIT_MS: z.coerce.number().int().positive().default(800)
});

export const env = envSchema.parse(process.env);

export const corsOrigins = env.CORS_ORIGIN.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export function isAllowedOrigin(origin?: string): boolean {
  return !origin || corsOrigins.includes(origin);
}

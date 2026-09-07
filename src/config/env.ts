import { z } from 'zod';

import { AppError } from '../errors/app-error';
import type { Bindings } from '../types/app';

const workerEnvSchema = z.object({
  ENVIRONMENT: z.string().optional(),
  API_VERSION: z.string().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  TARABUT_CLIENT_ID: z.string().min(1).optional(),
  TARABUT_CLIENT_SECRET: z.string().min(1).optional(),
  TARABUT_OAUTH_URL: z.string().url().optional(),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function parseWorkerEnv(bindings: Partial<Bindings> = {}): WorkerEnv {
  const parsed = workerEnvSchema.safeParse(bindings);

  if (!parsed.success) {
    throw new AppError(
      500,
      'CONFIGURATION_ERROR',
      'Worker environment is not configured correctly.',
    );
  }

  return parsed.data;
}

export function getSupabaseAuthConfig(bindings: Partial<Bindings> = {}) {
  const env = parseWorkerEnv(bindings);

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new AppError(
      500,
      'CONFIGURATION_ERROR',
      'Supabase authentication is not configured.',
    );
  }

  return {
    supabaseUrl: env.SUPABASE_URL,
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
  };
}

export function getAllowedOrigins(bindings: Partial<Bindings> = {}): string[] {
  return (
    parseWorkerEnv(bindings)
      .ALLOWED_ORIGINS?.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean) ?? []
  );
}

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
  ACCOUNT_IDENTITY_HMAC_SECRET: z.string().min(1).optional(),
  BIRD_ACCESS_KEY: z.string().min(1).optional(),
  BIRD_WORKSPACE_ID: z.string().min(1).optional(),
  BIRD_CHANNEL_ID: z.string().min(1).optional(),
  SEND_SMS_HOOK_SECRET: z.string().min(1).optional(),
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

export function getSupabaseServiceConfig(bindings: Partial<Bindings> = {}) {
  const env = parseWorkerEnv(bindings);

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new AppError(
      500,
      'CONFIGURATION_ERROR',
      'Supabase service role is not configured.',
    );
  }

  return {
    supabaseUrl: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

export function getAccountIdentityHmacSecret(bindings: Partial<Bindings> = {}) {
  const env = parseWorkerEnv(bindings);

  if (!env.ACCOUNT_IDENTITY_HMAC_SECRET) {
    throw new AppError(
      500,
      'CONFIGURATION_ERROR',
      'Account deletion identity HMAC secret is not configured.',
    );
  }

  return env.ACCOUNT_IDENTITY_HMAC_SECRET;
}

export function getBirdSmsConfig(bindings: Partial<Bindings> = {}) {
  const env = parseWorkerEnv(bindings);

  if (!env.BIRD_ACCESS_KEY || !env.BIRD_WORKSPACE_ID || !env.BIRD_CHANNEL_ID) {
    throw new AppError(
      500,
      'CONFIGURATION_ERROR',
      'Bird SMS delivery is not configured.',
    );
  }

  return {
    accessKey: env.BIRD_ACCESS_KEY,
    workspaceId: env.BIRD_WORKSPACE_ID,
    channelId: env.BIRD_CHANNEL_ID,
  };
}

export function getSendSmsHookSecret(bindings: Partial<Bindings> = {}) {
  const env = parseWorkerEnv(bindings);

  if (!env.SEND_SMS_HOOK_SECRET) {
    throw new AppError(
      500,
      'CONFIGURATION_ERROR',
      'Send SMS hook signing secret is not configured.',
    );
  }

  return env.SEND_SMS_HOOK_SECRET;
}

export function getAllowedOrigins(bindings: Partial<Bindings> = {}): string[] {
  return (
    parseWorkerEnv(bindings)
      .ALLOWED_ORIGINS?.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean) ?? []
  );
}

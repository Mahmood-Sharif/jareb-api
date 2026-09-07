import { AppError } from '../../errors/app-error';
import type { Bindings } from '../../types/app';
import { parseWorkerEnv } from '../../config/env';

export const TARABUT_SANDBOX_OAUTH_URL =
  'https://oauth.tarabutgateway.io/sandbox';

export type TarabutConfig = {
  clientId: string;
  clientSecret: string;
  oauthUrl: string;
};

function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, '');
}

export function getTarabutConfig(bindings: Partial<Bindings> = {}): TarabutConfig {
  const env = parseWorkerEnv(bindings);
  const oauthUrl = env.TARABUT_OAUTH_URL ?? TARABUT_SANDBOX_OAUTH_URL;

  if (!env.TARABUT_CLIENT_ID || !env.TARABUT_CLIENT_SECRET) {
    throw new AppError(
      500,
      'CONFIGURATION_ERROR',
      'Tarabut authentication is not configured.',
    );
  }

  return {
    clientId: env.TARABUT_CLIENT_ID,
    clientSecret: env.TARABUT_CLIENT_SECRET,
    oauthUrl: normalizeBaseUrl(oauthUrl),
  };
}

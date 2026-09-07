import { AppError } from '../../errors/app-error';
import type { Bindings } from '../../types/app';
import { postTarabutToken, type TarabutFetch } from './client';
import { getTarabutConfig } from './config';
import type {
  TarabutAccessTokenRequest,
  TarabutAccessTokenResponse,
  TarabutTokenCacheKeyParts,
} from './types';

const TOKEN_EXPIRY_SAFETY_BUFFER_MS = 60_000;
const MAX_CUSTOMER_USER_ID_LENGTH = 40;

type TokenCacheEntry = {
  response: TarabutAccessTokenResponse;
  refreshAtMs: number;
};

const tokenCache = new Map<string, TokenCacheEntry>();

function buildTokenCacheKey(parts: TarabutTokenCacheKeyParts) {
  return JSON.stringify({
    oauthUrl: parts.oauthUrl,
    clientId: parts.clientId,
    scopes: parts.scopes ?? '',
    redirectUri: parts.redirectUri ?? '',
    customerUserId: parts.customerUserId ?? '',
  });
}

function getRefreshAt(nowMs: number, expiresInSeconds: number) {
  const expiresAtMs = nowMs + expiresInSeconds * 1000;
  return Math.max(nowMs, expiresAtMs - TOKEN_EXPIRY_SAFETY_BUFFER_MS);
}

function validateCustomerUserId(customerUserId?: string) {
  if (!customerUserId) return;

  if (customerUserId.length > MAX_CUSTOMER_USER_ID_LENGTH) {
    throw new AppError(
      500,
      'CONFIGURATION_ERROR',
      'Tarabut customer user id is too long.',
    );
  }
}

export function clearTarabutTokenCache() {
  tokenCache.clear();
}

export async function getTarabutAccessToken({
  env,
  scopes,
  redirectUri,
  customerUserId,
  fetcher,
  now = () => Date.now(),
}: TarabutAccessTokenRequest & {
  env: Partial<Bindings>;
  fetcher?: TarabutFetch;
  now?: () => number;
}): Promise<TarabutAccessTokenResponse> {
  validateCustomerUserId(customerUserId);

  const config = getTarabutConfig(env);
  const cacheKey = buildTokenCacheKey({
    oauthUrl: config.oauthUrl,
    clientId: config.clientId,
    scopes,
    redirectUri,
    customerUserId,
  });
  const nowMs = now();
  const cached = tokenCache.get(cacheKey);

  if (cached && cached.refreshAtMs > nowMs) {
    return cached.response;
  }

  const body: Record<string, string> = {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    grantType: 'client_credentials',
  };

  if (scopes) {
    body.scopes = scopes;
  }

  if (redirectUri) {
    body.redirect_uri = redirectUri;
  }

  const response = await postTarabutToken({
    url: `${config.oauthUrl}/token`,
    body,
    customerUserId,
    fetcher,
  });

  tokenCache.set(cacheKey, {
    response,
    refreshAtMs: getRefreshAt(nowMs, response.expiresIn),
  });

  return response;
}

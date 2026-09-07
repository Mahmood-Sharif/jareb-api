import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AppError } from '../src/errors/app-error';
import {
  clearTarabutTokenCache,
  getTarabutAccessToken,
} from '../src/integrations/tarabut/auth';
import { TarabutIntegrationError } from '../src/integrations/tarabut/errors';
import type { Bindings } from '../src/types/app';

const env: Partial<Bindings> = {
  TARABUT_CLIENT_ID: 'client-id',
  TARABUT_CLIENT_SECRET: 'client-secret',
  TARABUT_OAUTH_URL: 'https://oauth.tarabutgateway.io/sandbox',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function tokenResponse(accessToken = 'token-1', expiresIn = 900) {
  return {
    accessToken,
    scope: 'accounts',
    expiresIn,
    tokenType: 'Bearer',
  };
}

function getFetchCall(fetcher: ReturnType<typeof vi.fn>) {
  return fetcher.mock.calls[0] as unknown as [string, RequestInit];
}

describe('Tarabut access token authentication', () => {
  beforeEach(() => {
    clearTarabutTokenCache();
  });

  it('requests and parses a successful access token', async () => {
    const fetcher = vi.fn(async () => jsonResponse(tokenResponse()));

    const response = await getTarabutAccessToken({ env, fetcher });

    expect(response).toEqual(tokenResponse());
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('uses the documented token endpoint', async () => {
    const fetcher = vi.fn(async () => jsonResponse(tokenResponse()));

    await getTarabutAccessToken({ env, fetcher });

    expect(getFetchCall(fetcher)[0]).toBe(
      'https://oauth.tarabutgateway.io/sandbox/token',
    );
  });

  it('sends client credentials with the client_credentials grant type', async () => {
    const fetcher = vi.fn(async () => jsonResponse(tokenResponse()));

    await getTarabutAccessToken({ env, fetcher });

    const init = getFetchCall(fetcher)[1];
    expect(JSON.parse(String(init.body))).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      grantType: 'client_credentials',
    });
  });

  it('sends application/json content type', async () => {
    const fetcher = vi.fn(async () => jsonResponse(tokenResponse()));

    await getTarabutAccessToken({ env, fetcher });

    const init = getFetchCall(fetcher)[1];
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
    });
  });

  it('supports optional X-TG-CustomerUserId', async () => {
    const fetcher = vi.fn(async () => jsonResponse(tokenResponse()));

    await getTarabutAccessToken({
      env,
      customerUserId: 'jareb-user-123',
      fetcher,
    });

    const init = getFetchCall(fetcher)[1];
    expect(init.headers).toMatchObject({
      'X-TG-CustomerUserId': 'jareb-user-123',
    });
  });

  it('supports optional scopes and redirect uri', async () => {
    const fetcher = vi.fn(async () => jsonResponse(tokenResponse()));

    await getTarabutAccessToken({
      env,
      scopes: 'accounts payments',
      redirectUri: 'https://api.jareb.app/callback',
      fetcher,
    });

    const init = getFetchCall(fetcher)[1];
    expect(JSON.parse(String(init.body))).toMatchObject({
      scopes: 'accounts payments',
      redirect_uri: 'https://api.jareb.app/callback',
    });
  });

  it('reuses a cached token while it is valid', async () => {
    const fetcher = vi.fn(async () => jsonResponse(tokenResponse('cached-token')));

    const first = await getTarabutAccessToken({ env, fetcher, now: () => 0 });
    const second = await getTarabutAccessToken({
      env,
      fetcher,
      now: () => 100_000,
    });

    expect(first.accessToken).toBe('cached-token');
    expect(second.accessToken).toBe('cached-token');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('refreshes shortly before expiry', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenResponse('token-1', 900)))
      .mockResolvedValueOnce(jsonResponse(tokenResponse('token-2', 900)));

    await getTarabutAccessToken({ env, fetcher, now: () => 0 });
    const refreshed = await getTarabutAccessToken({
      env,
      fetcher,
      now: () => 840_000,
    });

    expect(refreshed.accessToken).toBe('token-2');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps differently scoped or customer-specific tokens separate', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenResponse('accounts-token')))
      .mockResolvedValueOnce(jsonResponse(tokenResponse('payments-token')))
      .mockResolvedValueOnce(jsonResponse(tokenResponse('customer-token')));

    await getTarabutAccessToken({ env, scopes: 'accounts', fetcher });
    await getTarabutAccessToken({ env, scopes: 'payments', fetcher });
    await getTarabutAccessToken({
      env,
      scopes: 'payments',
      customerUserId: 'user-1',
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('maps 400 Tarabut errors with trace details', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        {
          error: 'invalid_client',
          errorMessage: 'Client credentials are invalid.',
          traceId: 'trace-400',
          details: [{ field: 'clientId' }],
        },
        400,
      ),
    );

    await expect(getTarabutAccessToken({ env, fetcher })).rejects.toMatchObject({
      providerStatus: 400,
      providerError: 'invalid_client',
      providerErrorMessage: 'Client credentials are invalid.',
      traceId: 'trace-400',
      details: [{ field: 'clientId' }],
    });
  });

  it('maps 500 Tarabut errors with trace details', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        {
          error: 'server_error',
          errorMessage: 'Tarabut could not process the request.',
          traceId: 'trace-500',
        },
        500,
      ),
    );

    await expect(getTarabutAccessToken({ env, fetcher })).rejects.toMatchObject({
      providerStatus: 500,
      providerError: 'server_error',
      providerErrorMessage: 'Tarabut could not process the request.',
      traceId: 'trace-500',
    });
  });

  it('fails safely for malformed successful token responses', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ accessToken: 'token-1', expiresIn: 900 }),
    );

    await expect(getTarabutAccessToken({ env, fetcher })).rejects.toBeInstanceOf(
      TarabutIntegrationError,
    );
    await expect(getTarabutAccessToken({ env, fetcher })).rejects.toMatchObject({
      message: 'Tarabut authentication response was malformed.',
    });
  });

  it('fails cleanly when credentials are missing', async () => {
    await expect(
      getTarabutAccessToken({
        env: { TARABUT_CLIENT_ID: 'client-id' },
        fetcher: vi.fn(),
      }),
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: 'Tarabut authentication is not configured.',
    });
  });

  it('does not expose secrets or full tokens in primary error messages', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        {
          error: 'invalid_client',
          errorMessage: 'The upstream body is intentionally not used as the error message.',
          traceId: 'trace-safe',
        },
        400,
      ),
    );

    let error: unknown;

    try {
      await getTarabutAccessToken({ env, fetcher });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(TarabutIntegrationError);
    expect((error as Error).message).not.toContain('client-secret');
    expect((error as Error).message).not.toContain('accessToken');
    expect((error as Error).message).not.toContain('token-1');
  });

  it('rejects overlong customer user ids before calling Tarabut', async () => {
    const fetcher = vi.fn();

    await expect(
      getTarabutAccessToken({
        env,
        customerUserId: 'x'.repeat(41),
        fetcher,
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

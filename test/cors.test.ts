import type { User } from '@supabase/supabase-js';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/index';
import { withCors } from '../src/middleware/cors';
import type { RewardsService } from '../src/services/rewards';
import type { AppEnv, Bindings } from '../src/types/app';

const flutterWebOrigin = 'http://127.0.0.1:54321';
const configuredOrigin = 'https://app.jareb.com';
const testBindings: Partial<Bindings> = {
  ALLOWED_ORIGINS: configuredOrigin,
};

const authUser = {
  id: 'user_123',
  email: 'customer@example.com',
} as User;

const rewardService: RewardsService = {
  listDrops: vi.fn(async () => []),
  getDrop: vi.fn(),
  claimDrop: vi.fn(),
  listClaims: vi.fn(),
  listActiveClaims: vi.fn(),
  getClaim: vi.fn(),
  saveClaimPayoutPhone: vi.fn(),
  verifyClaimMerchantPin: vi.fn(),
};

function expectCors(response: Response, origin = flutterWebOrigin) {
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  expect(response.headers.get('Vary')).toContain('Origin');
}

describe('CORS', () => {
  it('handles OPTIONS /drops preflight for Flutter Web development origins', async () => {
    const response = await createApp().request(
      '/drops',
      {
        headers: {
          Origin: flutterWebOrigin,
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'Authorization,Content-Type',
        },
        method: 'OPTIONS',
      },
      testBindings,
    );

    expect(response.status).toBe(204);
    expectCors(response);
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('preserves configured production allowed origins', async () => {
    const response = await createApp().request(
      '/health',
      {
        headers: {
          Origin: configuredOrigin,
        },
      },
      testBindings,
    );

    expect(response.status).toBe(200);
    expectCors(response, configuredOrigin);
  });

  it('adds CORS to successful GET /drops responses', async () => {
    const response = await createApp({
      getUserFromToken: async () => authUser,
      rewardService,
    }).request(
      '/drops',
      {
        headers: {
          Authorization: 'Bearer valid-token',
          Origin: flutterWebOrigin,
        },
      },
      testBindings,
    );

    expect(response.status).toBe(200);
    expectCors(response);
  });

  it.each([
    ['401 responses', '/drops', { Origin: flutterWebOrigin }],
    [
      '400 responses',
      '/me',
      {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
        Origin: flutterWebOrigin,
      },
      'PATCH',
      JSON.stringify({ fullName: '', phone: '' }),
    ],
    ['404 responses', '/missing', { Origin: flutterWebOrigin }],
  ])('adds CORS to %s', async (_label, path, headers, method = 'GET', body?: string) => {
    const response = await createApp({
      getUserFromToken: async () => authUser,
    }).request(
      path,
      {
        body,
        headers,
        method,
      },
      testBindings,
    );

    expectCors(response);
  });

  it('adds CORS to 403 responses', async () => {
    const app = new Hono<AppEnv>();

    app.use('*', withCors());
    app.get('/forbidden', (c) => c.json({ error: 'Forbidden' }, 403));

    const response = await app.request(
      '/forbidden',
      {
        headers: {
          Origin: flutterWebOrigin,
        },
      },
      testBindings,
    );

    expect(response.status).toBe(403);
    expectCors(response);
  });

  it('adds CORS to 500 responses', async () => {
    const response = await createApp({
      getUserFromToken: async () => authUser,
      rewardService: {
        ...rewardService,
        listDrops: vi.fn(async () => {
          throw new Error('Database unavailable');
        }),
      },
    }).request(
      '/drops',
      {
        headers: {
          Authorization: 'Bearer valid-token',
          Origin: flutterWebOrigin,
        },
      },
      testBindings,
    );

    expect(response.status).toBe(500);
    expectCors(response);
  });
});

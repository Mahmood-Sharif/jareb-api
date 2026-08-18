import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { jsonError, toAppError } from '../src/errors/app-error';
import { createRequireAuth, requireAuth } from '../src/middleware/auth';
import type { AppEnv } from '../src/types/app';

describe('requireAuth', () => {
  it('returns 401 when the bearer token is missing', async () => {
    const app = new Hono<AppEnv>();

    app.onError((error, c) => jsonError(c, toAppError(error)));
    app.get('/private', requireAuth, (c) => c.json({ ok: true }));

    const response = await app.request('/private');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      },
    });
  });

  it('returns 401 when the bearer token is malformed', async () => {
    const app = new Hono<AppEnv>();

    app.onError((error, c) => jsonError(c, toAppError(error)));
    app.get('/private', requireAuth, (c) => c.json({ ok: true }));

    const response = await app.request('/private', {
      headers: {
        Authorization: 'Bearer token extra',
      },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      },
    });
  });

  it('returns 401 when token verification fails', async () => {
    const app = new Hono<AppEnv>();
    const requireInvalidAuth = createRequireAuth(async () => null);

    app.onError((error, c) => jsonError(c, toAppError(error)));
    app.get('/private', requireInvalidAuth, (c) => c.json({ ok: true }));

    const response = await app.request('/private', {
      headers: {
        Authorization: 'Bearer invalid-token',
      },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      },
    });
  });
});

import type { User } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/index';

const authUser = {
  id: 'user_123',
  email: 'customer@example.com',
} as User;

describe('GET /me', () => {
  it('returns 401 without Authorization', async () => {
    const response = await createApp().request('/me');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      },
    });
  });

  it('returns the authenticated user and profile', async () => {
    const loadProfile = vi.fn(async () => ({
      fullName: 'Jareb Customer',
      phone: '39999999',
      benefitpayNumber: '39999999',
    }));

    const response = await createApp({
      getUserFromToken: async () => authUser,
      loadProfile,
    }).request('/me?userId=someone_else', {
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });

    expect(response.status).toBe(200);
    expect(loadProfile).toHaveBeenCalledWith({
      accessToken: 'valid-token',
      bindings: {},
      userId: 'user_123',
    });
    await expect(response.json()).resolves.toEqual({
      user: {
        id: 'user_123',
        email: 'customer@example.com',
        profile: {
          fullName: 'Jareb Customer',
          phone: '39999999',
          benefitpayNumber: '39999999',
        },
      },
    });
  });

  it('returns profile null when no profile row exists', async () => {
    const response = await createApp({
      getUserFromToken: async () => authUser,
      loadProfile: async () => null,
    }).request('/me', {
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      user: {
        id: 'user_123',
        email: 'customer@example.com',
        profile: null,
      },
    });
  });
});

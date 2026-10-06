import type { User } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../src/errors/app-error';
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
      termsAcceptedAt: '2026-10-06T09:00:00.000Z',
      termsVersion: '2026-10-06',
      privacyVersion: '2026-10-06',
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
          termsAcceptedAt: '2026-10-06T09:00:00.000Z',
          termsVersion: '2026-10-06',
          privacyVersion: '2026-10-06',
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

describe('DELETE /me', () => {
  it('returns 401 without Authorization', async () => {
    const response = await createApp().request('/me', {
      method: 'DELETE',
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      },
    });
  });

  it('deletes the authenticated account and ignores client user ids', async () => {
    const deleteAccount = vi.fn(async () => ({ deleted: true as const }));

    const response = await createApp({
      deleteAccount,
      getUserFromToken: async () => authUser,
    }).request('/me?userId=someone_else', {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });

    expect(response.status).toBe(200);
    expect(deleteAccount).toHaveBeenCalledWith({
      bindings: {},
      userId: 'user_123',
    });
    await expect(response.json()).resolves.toEqual({ deleted: true });
  });

  it('returns a stable account deletion failure without leaking raw errors', async () => {
    const deleteAccount = vi.fn(async () => {
      throw new AppError(500, 'ACCOUNT_DELETE_FAILED', 'Could not delete account.');
    });

    const response = await createApp({
      deleteAccount,
      getUserFromToken: async () => authUser,
    }).request('/me', {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'ACCOUNT_DELETE_FAILED',
        message: 'Could not delete account.',
      },
    });
  });
});

describe('PATCH /me', () => {
  it('returns 401 without Authorization', async () => {
    const response = await createApp().request('/me', {
      method: 'PATCH',
      body: JSON.stringify({
        fullName: 'Jareb Customer',
        phone: '39999999',
        benefitpayNumber: '39999999',
      }),
      headers: {
        'Content-Type': 'application/json',
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

  it('validates the profile payload', async () => {
    const response = await createApp({
      getUserFromToken: async () => authUser,
    }).request('/me', {
      method: 'PATCH',
      body: JSON.stringify({
        fullName: '',
        phone: '',
      }),
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'fullName is required.',
      },
    });
  });

  it('updates the authenticated user profile and ignores client user ids', async () => {
    const updateProfile = vi.fn(async () => ({
      fullName: 'Jareb Customer',
      phone: '+97339999999',
      benefitpayNumber: '+97338888888',
      termsAcceptedAt: '2026-10-06T09:00:00.000Z',
      termsVersion: '2026-10-06',
      privacyVersion: '2026-10-06',
    }));

    const response = await createApp({
      getUserFromToken: async () => authUser,
      updateProfile,
    }).request('/me', {
      method: 'PATCH',
      body: JSON.stringify({
        userId: 'someone_else',
        fullName: 'Jareb Customer',
        phone: '39999999',
        benefitpayNumber: '38888888',
      }),
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
    });

    expect(response.status).toBe(200);
    expect(updateProfile).toHaveBeenCalledWith({
      accessToken: 'valid-token',
      bindings: {},
      fullName: 'Jareb Customer',
      phone: '39999999',
      benefitpayNumber: '38888888',
      termsVersion: undefined,
      privacyVersion: undefined,
    });
    await expect(response.json()).resolves.toEqual({
      user: {
        id: 'user_123',
        email: 'customer@example.com',
        profile: {
          fullName: 'Jareb Customer',
          phone: '+97339999999',
          benefitpayNumber: '+97338888888',
          termsAcceptedAt: '2026-10-06T09:00:00.000Z',
          termsVersion: '2026-10-06',
          privacyVersion: '2026-10-06',
        },
      },
    });
  });

  it('accepts profile completion without a client-supplied phone', async () => {
    const updateProfile = vi.fn(async () => ({
      fullName: 'Phone Customer',
      phone: '+97336000009',
      benefitpayNumber: '+97336000009',
      termsAcceptedAt: '2026-10-06T09:15:00.000Z',
      termsVersion: '2026-10-06',
      privacyVersion: '2026-10-06',
    }));

    const response = await createApp({
      getUserFromToken: async () => ({ ...authUser, phone: '+97336000009' }) as User,
      updateProfile,
    }).request('/me', {
      method: 'PATCH',
      body: JSON.stringify({
        fullName: 'Phone Customer',
        benefitpayNumber: '36000009',
        termsVersion: '2026-10-06',
        privacyVersion: '2026-10-06',
      }),
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
    });

    expect(response.status).toBe(200);
    expect(updateProfile).toHaveBeenCalledWith({
      accessToken: 'valid-token',
      bindings: {},
      fullName: 'Phone Customer',
      phone: undefined,
      benefitpayNumber: '36000009',
      termsVersion: '2026-10-06',
      privacyVersion: '2026-10-06',
    });
    await expect(response.json()).resolves.toEqual({
      user: {
        id: 'user_123',
        email: 'customer@example.com',
        profile: {
          fullName: 'Phone Customer',
          phone: '+97336000009',
          benefitpayNumber: '+97336000009',
          termsAcceptedAt: '2026-10-06T09:15:00.000Z',
          termsVersion: '2026-10-06',
          privacyVersion: '2026-10-06',
        },
      },
    });
  });
});

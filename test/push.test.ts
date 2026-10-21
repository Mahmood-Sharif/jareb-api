import type { User } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src';
import type { PushDeviceService } from '../src/services/push-devices';

const authUser = { id: 'push-user-123' } as User;

function createService(): PushDeviceService {
  return {
    registerDevice: vi.fn(async () => ({ registered: true as const })),
    unregisterDevice: vi.fn(async () => ({ unregistered: true as const })),
  };
}

function createAuthenticatedApp(service: PushDeviceService) {
  return createApp({
    getUserFromToken: async () => authUser,
    pushDevices: service,
  });
}

describe('push device API', () => {
  it('protects device registration with bearer authentication', async () => {
    const response = await createApp().request('/push/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'fcm-token', platform: 'android' }),
    });

    expect(response.status).toBe(401);
  });

  it('registers a device against only the authenticated user', async () => {
    const service = createService();
    const response = await createAuthenticatedApp(service).request(
      '/push/devices',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: 'fcm-token',
          platform: 'ios',
          notificationsEnabled: true,
          userId: 'attacker',
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(service.registerDevice).toHaveBeenCalledWith({
      bindings: {},
      userId: authUser.id,
      token: 'fcm-token',
      platform: 'ios',
      notificationsEnabled: true,
    });
  });

  it('unregisters only the authenticated user device', async () => {
    const service = createService();
    const response = await createAuthenticatedApp(service).request(
      '/push/devices',
      {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: 'fcm-token' }),
      },
    );

    expect(response.status).toBe(200);
    expect(service.unregisterDevice).toHaveBeenCalledWith({
      bindings: {},
      userId: authUser.id,
      token: 'fcm-token',
    });
  });

  it('rejects invalid platform and empty token values', async () => {
    const service = createService();
    const response = await createAuthenticatedApp(service).request(
      '/push/devices',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: '', platform: 'windows' }),
      },
    );

    expect(response.status).toBe(400);
    expect(service.registerDevice).not.toHaveBeenCalled();
  });
});

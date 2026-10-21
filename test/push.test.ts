import type { User } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src';
import type { PushDeviceService } from '../src/services/push-devices';
import type { PushSender } from '../src/routes/push';

const authUser = { id: 'push-user-123' } as User;

function createService(): PushDeviceService {
  return {
    registerDevice: vi.fn(async () => ({ registered: true as const })),
    unregisterDevice: vi.fn(async () => ({ unregistered: true as const })),
  };
}

function createAuthenticatedApp(
  service: PushDeviceService,
  pushSender?: PushSender,
) {
  return createApp({
    getUserFromToken: async () => authUser,
    pushDevices: service,
    pushSender,
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

  it('protects the self-test endpoint with bearer authentication', async () => {
    const response = await createApp().request('/push/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(401);
  });

  it('sends a default test push only to the authenticated user', async () => {
    const service = createService();
    const pushSender = vi.fn<PushSender>(async () => ({
      attempted: 2,
      delivered: 1,
      failed: 1,
      disabled: 1,
    }));
    const response = await createAuthenticatedApp(service, pushSender).request(
      '/push/test',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      tokens_targeted: 2,
      sent: 1,
      failed: 1,
    });
    expect(pushSender).toHaveBeenCalledWith({
      bindings: {},
      userId: authUser.id,
      message: {
        title: 'Jareb test',
        body: 'Push notifications are working.',
        data: { type: 'test' },
      },
    });
  });

  it('accepts safe custom test notification fields', async () => {
    const service = createService();
    const pushSender = vi.fn<PushSender>(async () => ({
      attempted: 1,
      delivered: 1,
      failed: 0,
      disabled: 0,
    }));
    const dropId = '10000000-0000-0000-0000-000000000001';
    const response = await createAuthenticatedApp(service, pushSender).request(
      '/push/test',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Drop live',
          body: 'Open your Drop.',
          type: 'drop_live',
          drop_id: dropId,
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(pushSender).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: authUser.id,
        message: {
          title: 'Drop live',
          body: 'Open your Drop.',
          data: { type: 'drop_live', drop_id: dropId },
        },
      }),
    );
  });

  it('rejects attempts to supply an arbitrary target user', async () => {
    const service = createService();
    const pushSender = vi.fn<PushSender>();
    const response = await createAuthenticatedApp(service, pushSender).request(
      '/push/test',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ user_id: 'another-user' }),
      },
    );

    expect(response.status).toBe(400);
    expect(pushSender).not.toHaveBeenCalled();
  });
});

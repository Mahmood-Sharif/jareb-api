import { describe, expect, it, vi } from 'vitest';

import { getFirebaseMessagingConfig } from '../src/config/env';
import { createFirebasePushClient } from '../src/integrations/firebase/push';

const config = {
  projectId: 'jareb-app',
  clientEmail: 'firebase@example.iam.gserviceaccount.com',
  privateKey: 'unused-in-test',
};
const message = {
  title: 'A Drop is live',
  body: 'Open Jareb to see it.',
  data: { type: 'drop_live' as const, drop_id: 'drop-123' },
};

describe('Firebase HTTP v1 push client', () => {
  it('sends the expected authenticated HTTP v1 message', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ name: 'message-id' }), { status: 200 }),
    );
    const client = createFirebasePushClient({
      config,
      fetchFn,
      accessTokenProvider: async () => 'oauth-token',
    });

    await expect(client.send('device-token', message)).resolves.toEqual({
      accepted: true,
      invalidToken: false,
    });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://fcm.googleapis.com/v1/projects/jareb-app/messages:send',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer oauth-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: 'device-token',
            notification: {
              title: message.title,
              body: message.body,
            },
            android: {
              priority: 'HIGH',
              notification: {
                channel_id: 'jareb_alerts',
                sound: 'default',
              },
            },
            data: message.data,
          },
        }),
      }),
    );
  });

  it('marks unregistered tokens for disabling', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            status: 'NOT_FOUND',
            message: 'Requested entity was not found.',
            details: [{ errorCode: 'UNREGISTERED' }],
          },
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = createFirebasePushClient({
      config,
      fetchFn,
      accessTokenProvider: async () => 'oauth-token',
    });

    await expect(client.send('stale-token', message)).resolves.toEqual({
      accepted: false,
      invalidToken: true,
      error: {
        httpStatus: 404,
        code: 'UNREGISTERED',
        status: 'NOT_FOUND',
        message: 'Requested entity was not found.',
      },
    });
  });

  it('does not expose upstream validation failures', async () => {
    const token = 'sensitive-registration-token';
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 403,
            status: 'PERMISSION_DENIED',
            message: `Registration ${token} is not authorized.`,
          },
        }),
        { status: 403 },
      ),
    );
    const client = createFirebasePushClient({
      config,
      fetchFn,
      accessTokenProvider: async () => 'oauth-token',
    });

    await expect(client.send(token, message)).rejects.toMatchObject({
      code: 'PUSH_DELIVERY_FAILED',
      statusCode: 502,
      diagnostic: {
        httpStatus: 403,
        code: '403',
        status: 'PERMISSION_DENIED',
        message: 'Registration [redacted-token] is not authorized.',
      },
    });
  });
});

describe('Firebase messaging configuration', () => {
  const baseConfig = {
    FIREBASE_PROJECT_ID: ' jareb-app ',
    FIREBASE_CLIENT_EMAIL: 'firebase@example.iam.gserviceaccount.com',
  };

  it('accepts a PEM private key with real newlines', () => {
    const privateKey = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----';

    expect(
      getFirebaseMessagingConfig({
        ...baseConfig,
        FIREBASE_PRIVATE_KEY: privateKey,
      }),
    ).toEqual({
      projectId: 'jareb-app',
      clientEmail: 'firebase@example.iam.gserviceaccount.com',
      privateKey,
    });
  });

  it('converts escaped private-key newlines from Worker secrets', () => {
    expect(
      getFirebaseMessagingConfig({
        ...baseConfig,
        FIREBASE_PRIVATE_KEY:
          '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
      }).privateKey,
    ).toBe('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----');
  });
});

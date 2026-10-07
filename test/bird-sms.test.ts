import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/index';
import { BirdSmsError, createBirdSmsClient } from '../src/integrations/bird/sms';

const birdConfig = {
  accessKey: 'bk_eu1_test_access_key',
};

const hookSecret = `v1,whsec_${bytesToBase64(new TextEncoder().encode('hook-secret'))}`;

describe('Bird SMS client', () => {
  it('builds the Bird URL, auth header, recipient, and payload shape', async () => {
    const fetcher = vi.fn(async () => Response.json({ id: 'msg_123', status: 'accepted' }, {
      status: 202,
    }));
    const client = createBirdSmsClient({
      config: birdConfig,
      fetcher,
      timeoutMs: 1000,
    });

    const result = await client.sendVerificationSms({
      code: '123456',
      phone: '36000001',
    });

    expect(result).toEqual({
      messageId: 'msg_123',
      status: 'accepted',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://eu1.platform.bird.com/v1/sms/messages',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer bk_eu1_test_access_key',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }),
    );

    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    const request = calls[0][1];
    expect(JSON.parse(request.body as string)).toEqual({
      to: '+97336000001',
      from: 'Jareb',
      text: 'Your Jareb verification code is 123456',
      category: 'authentication',
    });
  });

  it('routes us1 Bird keys to the US SMS endpoint', async () => {
    const fetcher = vi.fn(async () => Response.json({}, { status: 202 }));
    const client = createBirdSmsClient({
      config: {
        accessKey: 'bk_us1_test_access_key',
      },
      fetcher,
      timeoutMs: 1000,
    });

    await client.sendVerificationSms({
      code: '123456',
      phone: '+97336000001',
    });

    expect(fetcher).toHaveBeenCalledWith(
      'https://us1.platform.bird.com/v1/sms/messages',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer bk_us1_test_access_key',
        }),
      }),
    );
  });

  it('trims Bird access keys before region routing and authorization', async () => {
    const fetcher = vi.fn(async () => Response.json({}, { status: 202 }));
    const client = createBirdSmsClient({
      config: {
        accessKey: '  bk_eu1_test_access_key  ',
      },
      fetcher,
      timeoutMs: 1000,
    });

    await client.sendVerificationSms({
      code: '123456',
      phone: '+97336000001',
    });

    expect(fetcher).toHaveBeenCalledWith(
      'https://eu1.platform.bird.com/v1/sms/messages',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer bk_eu1_test_access_key',
        }),
      }),
    );
  });

  it('rejects unsupported Bird API key regions before calling Bird', async () => {
    const fetcher = vi.fn();
    const client = createBirdSmsClient({
      config: {
        accessKey: 'bk_ap1_test_access_key',
      },
      fetcher,
      timeoutMs: 1000,
    });

    await expect(
      client.sendVerificationSms({
        code: '123456',
        phone: '+97336000001',
      }),
    ).rejects.toMatchObject({
      kind: 'configuration',
      statusCode: null,
    } satisfies Partial<BirdSmsError>);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'authentication'],
    [403, 'authentication'],
    [429, 'rate_limit'],
    [500, 'server'],
  ] as const)('maps Bird HTTP %s to %s failure', async (statusCode, kind) => {
    const client = createBirdSmsClient({
      config: birdConfig,
      fetcher: vi.fn(async () => new Response('{}', { status: statusCode })),
      timeoutMs: 1000,
    });

    await expect(
      client.sendVerificationSms({
        code: '123456',
        phone: '+97336000001',
      }),
    ).rejects.toMatchObject({
      kind,
      statusCode,
    } satisfies Partial<BirdSmsError>);
  });

  it('rejects non-Bahrain recipients before calling Bird', async () => {
    const fetcher = vi.fn();
    const client = createBirdSmsClient({
      config: birdConfig,
      fetcher,
      timeoutMs: 1000,
    });

    await expect(
      client.sendVerificationSms({
        code: '123456',
        phone: '+15555550123',
      }),
    ).rejects.toMatchObject({
      kind: 'recipient',
      statusCode: 400,
    } satisfies Partial<BirdSmsError>);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['36000001', '+97336000001'],
    ['97336000001', '+97336000001'],
    ['+973 3600 0001', '+97336000001'],
  ])('normalizes Bahrain phone value %s', async (inputPhone, expectedPhone) => {
    const fetcher = vi.fn(async () => Response.json({}, { status: 202 }));
    const client = createBirdSmsClient({
      config: birdConfig,
      fetcher,
      timeoutMs: 1000,
    });

    await client.sendVerificationSms({
      code: '123456',
      phone: inputPhone,
    });

    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    const request = calls[0][1];
    expect(JSON.parse(request.body as string)).toMatchObject({
      to: expectedPhone,
    });
  });

  it('captures sanitized Bird 400 diagnostics without OTPs or access keys', async () => {
    const client = createBirdSmsClient({
      config: birdConfig,
      fetcher: vi.fn(async () =>
        Response.json(
          {
            code: 'InvalidReceiver',
            message: 'Invalid phone +97336009655 for OTP 123456.',
            details: {
              field: 'to',
              value: '+97336009655',
            },
            request_id: 'req_123',
          },
          {
            headers: {
              'content-type': 'application/json',
              'x-request-id': 'req_header_123',
            },
            status: 400,
          },
        ),
      ),
      timeoutMs: 1000,
    });

    await expect(
      client.sendVerificationSms({
        code: '123456',
        phone: '+97336009655',
      }),
    ).rejects.toMatchObject({
      diagnostics: {
        birdCode: 'InvalidReceiver',
        birdMessage: 'Invalid phone +973****9655 for OTP [redacted-code].',
        birdDetails: {
          field: 'to',
          value: '+973****9655',
        },
        birdReference: null,
        birdRequestId: 'req_header_123',
        destination: '+973****9655',
        rawBodySnippet:
          '{"code":"InvalidReceiver","message":"Invalid phone +973****9655 for OTP [redacted-code].","details":{"field":"to","value":"+973****9655"},"request_id":"req_123"}',
        responseContentType: 'application/json',
        status: 400,
      },
      kind: 'recipient',
      statusCode: 400,
    } satisfies Partial<BirdSmsError>);
  });
});

describe('POST /auth/hooks/send-sms', () => {
  it('uses new_phone when phone-change payload has phone null', async () => {
    const sendVerificationSms = vi.fn(async () => ({
      messageId: 'msg_123',
      status: 'accepted',
    }));
    const body = JSON.stringify({
      user: {
        phone: null,
        new_phone: '+97336009655',
      },
      sms: {
        otp: '123456',
      },
    });
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    try {
      const response = await createApp({
        birdSmsClient: {
          sendVerificationSms,
        },
      }).request(
        '/auth/hooks/send-sms',
        {
          body,
          headers: await signedHookHeaders(body),
          method: 'POST',
        },
        {
          SEND_SMS_HOOK_SECRET: hookSecret,
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({});
      expect(sendVerificationSms).toHaveBeenCalledWith({
        code: '123456',
        phone: '+97336009655',
      });
      expect(JSON.stringify(consoleInfo.mock.calls)).toContain('new_phone');
      expect(JSON.stringify(consoleInfo.mock.calls)).toContain('+973****9655');
      expect(JSON.stringify(consoleInfo.mock.calls)).not.toContain('123456');
    } finally {
      consoleInfo.mockRestore();
    }
  });

  it('uses new_phone when phone-change payload has phone empty', async () => {
    const sendVerificationSms = vi.fn(async () => ({
      messageId: 'msg_123',
      status: 'accepted',
    }));
    const body = JSON.stringify({
      user: {
        phone: '',
        new_phone: '+97336009655',
      },
      sms: {
        otp: '123456',
      },
    });
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    try {
      const response = await createApp({
        birdSmsClient: {
          sendVerificationSms,
        },
      }).request(
        '/auth/hooks/send-sms',
        {
          body,
          headers: await signedHookHeaders(body),
          method: 'POST',
        },
        {
          SEND_SMS_HOOK_SECRET: hookSecret,
        },
      );

      expect(response.status).toBe(200);
      expect(sendVerificationSms).toHaveBeenCalledWith({
        code: '123456',
        phone: '+97336009655',
      });
      expect(JSON.stringify(consoleInfo.mock.calls)).toContain('new_phone');
      expect(JSON.stringify(consoleInfo.mock.calls)).toContain('+973****9655');
      expect(JSON.stringify(consoleInfo.mock.calls)).not.toContain('123456');
    } finally {
      consoleInfo.mockRestore();
    }
  });

  it('falls back to user phone when new_phone is absent', async () => {
    const sendVerificationSms = vi.fn(async () => ({
      messageId: 'msg_123',
      status: 'accepted',
    }));
    const body = JSON.stringify({
      user: {
        phone: '+97336000001',
      },
      sms: {
        otp: '123456',
      },
    });
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    try {
      const response = await createApp({
        birdSmsClient: {
          sendVerificationSms,
        },
      }).request(
        '/auth/hooks/send-sms',
        {
          body,
          headers: await signedHookHeaders(body),
          method: 'POST',
        },
        {
          SEND_SMS_HOOK_SECRET: hookSecret,
        },
      );

      expect(response.status).toBe(200);
      expect(sendVerificationSms).toHaveBeenCalledWith({
        code: '123456',
        phone: '+97336000001',
      });
      expect(JSON.stringify(consoleInfo.mock.calls)).toContain('phone');
      expect(JSON.stringify(consoleInfo.mock.calls)).toContain('+973****0001');
      expect(JSON.stringify(consoleInfo.mock.calls)).not.toContain('123456');
    } finally {
      consoleInfo.mockRestore();
    }
  });

  it('rejects Send SMS hook events with no phone destination', async () => {
    const sendVerificationSms = vi.fn();
    const body = JSON.stringify({
      user: {
        phone: null,
        new_phone: null,
      },
      sms: {
        otp: '123456',
      },
    });

    const response = await createApp({
      birdSmsClient: {
        sendVerificationSms,
      },
    }).request(
      '/auth/hooks/send-sms',
      {
        body,
        headers: await signedHookHeaders(body),
        method: 'POST',
      },
      {
        SEND_SMS_HOOK_SECRET: hookSecret,
      },
    );

    expect(response.status).toBe(400);
    expect(sendVerificationSms).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        http_code: 400,
        message: 'Unable to send verification SMS.',
      },
    });
  });

  it('rejects malformed Send SMS hook payloads before sending SMS', async () => {
    const sendVerificationSms = vi.fn();
    const body = JSON.stringify({
      user: {
        phone: '+97336000001',
      },
      sms: {},
    });

    const response = await createApp({
      birdSmsClient: {
        sendVerificationSms,
      },
    }).request(
      '/auth/hooks/send-sms',
      {
        body,
        headers: await signedHookHeaders(body),
        method: 'POST',
      },
      {
        SEND_SMS_HOOK_SECRET: hookSecret,
      },
    );

    expect(response.status).toBe(400);
    expect(sendVerificationSms).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        http_code: 400,
        message: 'Unable to send verification SMS.',
      },
    });
  });

  it('rejects invalid JSON before sending SMS', async () => {
    const sendVerificationSms = vi.fn();
    const body = '{not json';

    const response = await createApp({
      birdSmsClient: {
        sendVerificationSms,
      },
    }).request(
      '/auth/hooks/send-sms',
      {
        body,
        headers: await signedHookHeaders(body),
        method: 'POST',
      },
      {
        SEND_SMS_HOOK_SECRET: hookSecret,
      },
    );

    expect(response.status).toBe(400);
    expect(sendVerificationSms).not.toHaveBeenCalled();
  });

  it('rejects bad hook signatures before sending SMS', async () => {
    const sendVerificationSms = vi.fn();
    const body = JSON.stringify({
      user: {
        phone: '+97336000001',
      },
      sms: {
        otp: '123456',
      },
    });

    const headers = await signedHookHeaders(body);
    headers['webhook-signature'] = 'v1,bad_signature';

    const response = await createApp({
      birdSmsClient: {
        sendVerificationSms,
      },
    }).request(
      '/auth/hooks/send-sms',
      {
        body,
        headers,
        method: 'POST',
      },
      {
        SEND_SMS_HOOK_SECRET: hookSecret,
      },
    );

    expect(response.status).toBe(401);
    expect(sendVerificationSms).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        http_code: 401,
        message: 'Invalid hook signature.',
      },
    });
  });

  it('returns a controlled failure when Bird is rate limited without logging OTP', async () => {
    const body = JSON.stringify({
      user: {
        phone: '+97336000001',
      },
      sms: {
        otp: '123456',
      },
    });
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const response = await createApp({
        birdSmsClient: {
          sendVerificationSms: vi.fn(async () => {
            throw new BirdSmsError('rate_limit', 429, 'Bird SMS rate limit reached.');
          }),
        },
      }).request(
        '/auth/hooks/send-sms',
        {
          body,
          headers: await signedHookHeaders(body),
          method: 'POST',
        },
        {
          SEND_SMS_HOOK_SECRET: hookSecret,
        },
      );

      expect(response.status).toBe(429);
      await expect(response.json()).resolves.toEqual({
        error: {
          http_code: 429,
          message: 'Unable to send verification SMS right now.',
        },
      });
      expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain('123456');
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it('logs safe Bird diagnostics for rejected sends', async () => {
    const body = JSON.stringify({
      user: {
        phone: '+97336009655',
      },
      sms: {
        otp: '123456',
      },
    });
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const response = await createApp({
        birdSmsClient: {
          sendVerificationSms: vi.fn(async () => {
            throw new BirdSmsError('recipient', 400, 'Bird SMS recipient request failed.', {
              birdCode: 'InvalidReceiver',
              birdDetails: {
                field: 'to',
              },
              birdMessage: 'Invalid receiver',
              birdReference: 'ref_123',
              birdRequestId: 'req_123',
              destination: '+973****9655',
              rawBodySnippet: 'Invalid receiver +973****9655 OTP [redacted-code]',
              responseContentType: 'text/plain',
              status: 400,
            });
          }),
        },
      }).request(
        '/auth/hooks/send-sms',
        {
          body,
          headers: await signedHookHeaders(body),
          method: 'POST',
        },
        {
          SEND_SMS_HOOK_SECRET: hookSecret,
        },
      );

      expect(response.status).toBe(400);
      const logs = JSON.stringify(consoleWarn.mock.calls);
      expect(logs).toContain('InvalidReceiver');
      expect(logs).toContain('+973****9655');
      expect(logs).not.toContain('123456');
      expect(logs).not.toContain('bk_eu1_test_access_key');
      expect(logs).not.toContain('+97336009655');
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it('rejects unsigned hook requests before sending SMS', async () => {
    const sendVerificationSms = vi.fn();
    const response = await createApp({
      birdSmsClient: {
        sendVerificationSms,
      },
    }).request(
      '/auth/hooks/send-sms',
      {
        body: JSON.stringify({
          user: {
            phone: '+97336000001',
          },
          sms: {
            otp: '123456',
          },
        }),
        method: 'POST',
      },
      {
        SEND_SMS_HOOK_SECRET: hookSecret,
      },
    );

    expect(response.status).toBe(401);
    expect(sendVerificationSms).not.toHaveBeenCalled();
  });
});

async function signedHookHeaders(body: string) {
  const webhookId = 'msg_hook_123';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await signHookPayload(`${webhookId}.${timestamp}.${body}`);

  return {
    'Content-Type': 'application/json',
    'webhook-id': webhookId,
    'webhook-signature': `v1,${signature}`,
    'webhook-timestamp': timestamp,
  };
}

async function signHookPayload(content: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('hook-secret'),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(content),
  );
  return bytesToBase64(new Uint8Array(signature));
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

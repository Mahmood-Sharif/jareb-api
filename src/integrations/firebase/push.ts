import { AppError } from '../../errors/app-error';

export const pushNotificationTypes = [
  'drop_live',
  'claim_expiring',
  'cashback_approved',
  'cashback_paid',
] as const;

export type PushNotificationType = (typeof pushNotificationTypes)[number];

export type FirebaseMessagingConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

export type PushMessage = {
  title: string;
  body: string;
  data: { type: PushNotificationType } & Record<string, string>;
};

export type FirebasePushClient = {
  send(token: string, message: PushMessage): Promise<{
    accepted: boolean;
    invalidToken: boolean;
  }>;
};

type Fetch = typeof fetch;

export function createFirebasePushClient({
  config,
  fetchFn = fetch,
  now = () => Date.now(),
  accessTokenProvider,
}: {
  config: FirebaseMessagingConfig;
  fetchFn?: Fetch;
  now?: () => number;
  accessTokenProvider?: () => Promise<string>;
}): FirebasePushClient {
  let cachedToken: { value: string; expiresAt: number } | undefined;

  return {
    async send(token, message) {
      const accessToken = accessTokenProvider
        ? await accessTokenProvider()
        : await getAccessToken();
      const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(
        config.projectId,
      )}/messages:send`;
      const response = await fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: message.title, body: message.body },
            data: message.data,
          },
        }),
      });

      console.log('FCM response received', { status: response.status });
      if (response.ok) return { accepted: true, invalidToken: false };

      const error = await parseFcmError(response);
      const invalidToken =
        error.code === 'UNREGISTERED' ||
        (error.status === 'INVALID_ARGUMENT' &&
          error.message.toLowerCase().includes('registration token'));

      if (invalidToken) return { accepted: false, invalidToken: true };

      console.error('FCM delivery failed', {
        status: response.status,
        code: error.status,
      });
      throw new AppError(
        502,
        'PUSH_DELIVERY_FAILED',
        'Push notification delivery failed.',
      );
    },
  };

  async function getAccessToken() {
    if (cachedToken && cachedToken.expiresAt > now() + 60_000) {
      return cachedToken.value;
    }

    const assertion = await createServiceAccountAssertion(config, now());
    const response = await fetchFn('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
    const payload = await safeJson(response);
    const accessToken = payload?.access_token;
    const expiresIn = payload?.expires_in;

    if (!response.ok || typeof accessToken !== 'string') {
      console.error('Firebase OAuth token request failed', {
        status: response.status,
      });
      throw new AppError(
        502,
        'PUSH_AUTHENTICATION_FAILED',
        'Push notification authentication failed.',
      );
    }

    cachedToken = {
      value: accessToken,
      expiresAt: now() + (typeof expiresIn === 'number' ? expiresIn : 3600) * 1000,
    };
    return accessToken;
  }
}

async function createServiceAccountAssertion(
  config: FirebaseMessagingConfig,
  nowMs: number,
) {
  const issuedAt = Math.floor(nowMs / 1000);
  const header = encodeJson({ alg: 'RS256', typ: 'JWT' });
  const claims = encodeJson({
    iss: config.clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: issuedAt,
    exp: issuedAt + 3600,
  });
  const unsigned = `${header}.${claims}`;

  try {
    const key = await crypto.subtle.importKey(
      'pkcs8',
      pemToBytes(config.privateKey),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      new TextEncoder().encode(unsigned),
    );
    return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  } catch {
    throw new AppError(
      500,
      'CONFIGURATION_ERROR',
      'Firebase messaging credentials are invalid.',
    );
  }
}

function pemToBytes(value: string) {
  const base64 = value
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeJson(value: unknown) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function base64Url(value: Uint8Array) {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function safeJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value = await response.json();
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function parseFcmError(response: Response) {
  const payload = await safeJson(response);
  const error = payload?.error;
  if (!error || typeof error !== 'object') {
    return { status: '', message: '', code: '' };
  }

  const record = error as Record<string, unknown>;
  const details = Array.isArray(record.details) ? record.details : [];
  const detail = details.find(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === 'object' && 'errorCode' in item,
  );
  return {
    status: typeof record.status === 'string' ? record.status : '',
    message: typeof record.message === 'string' ? record.message : '',
    code: typeof detail?.errorCode === 'string' ? detail.errorCode : '',
  };
}

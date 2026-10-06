import { AppError } from '../errors/app-error';

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

export async function verifyStandardWebhookSignature({
  body,
  headers,
  secret,
  nowSeconds = Math.floor(Date.now() / 1000),
}: {
  body: string;
  headers: Headers;
  secret: string;
  nowSeconds?: number;
}) {
  const webhookId = headers.get('webhook-id');
  const webhookTimestamp = headers.get('webhook-timestamp');
  const webhookSignature = headers.get('webhook-signature');

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid hook signature.');
  }

  const timestampSeconds = Number(webhookTimestamp);
  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS
  ) {
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid hook signature.');
  }

  const signingKey = extractSigningKey(secret);
  const signedContent = `${webhookId}.${webhookTimestamp}.${body}`;
  const expectedSignature = await hmacSha256Base64(signingKey, signedContent);
  const providedSignatures = webhookSignature
    .split(' ')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/^v\d+,/, ''));

  if (
    !providedSignatures.some((signature) =>
      timingSafeEqual(signature, expectedSignature),
    )
  ) {
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid hook signature.');
  }
}

function extractSigningKey(secret: string) {
  const primarySecret = secret.split('|')[0]?.trim() ?? '';
  const withoutVersion = primarySecret.replace(/^v\d+,/, '');
  return withoutVersion.replace(/^whsec_/, '');
}

async function hmacSha256Base64(base64Secret: string, content: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    base64ToBytes(base64Secret),
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

function timingSafeEqual(a: string, b: string) {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const length = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;

  for (let index = 0; index < length; index += 1) {
    diff |= (aBytes[index] ?? 0) ^ (bBytes[index] ?? 0);
  }

  return diff === 0;
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

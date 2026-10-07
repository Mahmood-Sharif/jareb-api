import { Hono } from 'hono';
import { z } from 'zod';

import { getBirdSmsConfig, getSendSmsHookSecret } from '../config/env';
import { AppError } from '../errors/app-error';
import {
  BirdSmsError,
  createBirdSmsClient,
  normalizeBahrainPhone,
  type BirdSmsClient,
} from '../integrations/bird/sms';
import { verifyStandardWebhookSignature } from '../services/webhook-signature';
import type { AppEnv } from '../types/app';

const sendSmsHookPayloadSchema = z.object({
  user: z.object({
    phone: z.string().optional().nullable(),
    new_phone: z.string().optional().nullable(),
  }),
  sms: z.object({
    otp: z.string().min(1),
  }),
});

export function createAuthHooksRoutes({
  birdSmsClient,
}: {
  birdSmsClient?: BirdSmsClient;
} = {}) {
  const routes = new Hono<AppEnv>();

  routes.post('/send-sms', async (c) => {
    console.info('SMS HOOK request received', {
      contentType: c.req.header('content-type') ?? null,
      hasSignature: Boolean(c.req.header('webhook-signature')),
      path: c.req.path,
    });

    const body = await c.req.text();

    try {
      await verifyStandardWebhookSignature({
        body,
        headers: c.req.raw.headers,
        secret: getSendSmsHookSecret(c.env),
      });
      console.info('SMS HOOK signature verified');

      const payload = parseJsonBody(body);
      const parsedPayload = sendSmsHookPayloadSchema.safeParse(payload);
      if (!parsedPayload.success) {
        console.warn('SMS HOOK payload invalid', {
          issues: parsedPayload.error.issues.map((issue) => issue.path.join('.')),
        });
        throw new AppError(400, 'BAD_REQUEST', 'Invalid Send SMS hook payload.');
      }
      console.info('SMS HOOK payload parsed', {
        hasNewPhone: Boolean(parsedPayload.data.user.new_phone?.trim()),
        hasOtp: Boolean(parsedPayload.data.sms.otp),
        hasPhone: Boolean(parsedPayload.data.user.phone?.trim()),
      });

      const rawNewPhone = parsedPayload.data.user.new_phone?.trim();
      const rawCurrentPhone = parsedPayload.data.user.phone?.trim();
      const destination = rawNewPhone || rawCurrentPhone;
      if (!destination) {
        throw new AppError(
          400,
          'BAD_REQUEST',
          'Send SMS hook payload has no phone destination.',
        );
      }
      const source = rawNewPhone ? 'new_phone' : 'phone';
      const normalizedDestination = normalizeBahrainPhone(destination);
      console.info('SMS HOOK destination normalized', {
        destination: maskBahrainPhone(normalizedDestination),
        source,
      });

      const client =
        birdSmsClient ??
        createBirdSmsClient({
          config: getBirdSmsConfig(c.env),
        });

      const result = await client.sendVerificationSms({
        code: parsedPayload.data.sms.otp,
        phone: normalizedDestination,
      });

      console.info('Bird SMS accepted', {
        messageId: result.messageId,
        phoneSuffix: phoneSuffix(normalizedDestination),
        status: result.status,
      });

      return c.json({}, 200);
    } catch (error) {
      const hookError = toSendSmsHookError(error);
      if (error instanceof AppError && error.code === 'UNAUTHORIZED') {
        console.warn('SMS HOOK signature verification failed');
      }

      console.warn('Bird SMS delivery failed', {
        bird: error instanceof BirdSmsError ? error.diagnostics : null,
        code: hookError.logCode,
        status: hookError.httpCode,
      });

      return c.json(
        {
          error: {
            http_code: hookError.httpCode,
            message: hookError.message,
          },
        },
        hookError.httpCode,
      );
    }
  });

  return routes;
}

function parseJsonBody(body: string) {
  try {
    return JSON.parse(body);
  } catch {
    console.warn('SMS HOOK JSON parse failed');
    throw new AppError(400, 'BAD_REQUEST', 'Invalid Send SMS hook payload.');
  }
}

function toSendSmsHookError(error: unknown): {
  httpCode: 400 | 401 | 429 | 500 | 502 | 503;
  logCode: string;
  message: string;
} {
  if (error instanceof AppError) {
    const httpCode =
      error.statusCode === 401 || error.statusCode === 400
        ? error.statusCode
        : 500;
    return {
      httpCode,
      logCode: error.code,
      message:
        error.code === 'UNAUTHORIZED'
          ? 'Invalid hook signature.'
          : 'Unable to send verification SMS.',
    };
  }

  if (error instanceof BirdSmsError) {
    if (error.kind === 'rate_limit') {
      return {
        httpCode: 429,
        logCode: 'BIRD_RATE_LIMIT',
        message: 'Unable to send verification SMS right now.',
      };
    }

    if (error.kind === 'network') {
      return {
        httpCode: 503,
        logCode: 'BIRD_NETWORK_FAILURE',
        message: 'Unable to send verification SMS right now.',
      };
    }

    if (error.kind === 'recipient') {
      return {
        httpCode: error.statusCode === 400 ? 400 : 502,
        logCode: 'BIRD_RECIPIENT_FAILURE',
        message: 'Unable to send verification SMS.',
      };
    }

    return {
      httpCode: 502,
      logCode: `BIRD_${error.kind.toUpperCase()}_FAILURE`,
      message: 'Unable to send verification SMS right now.',
    };
  }

  return {
    httpCode: 500,
    logCode: 'SEND_SMS_HOOK_FAILURE',
    message: 'Unable to send verification SMS.',
  };
}

function phoneSuffix(phone: string) {
  return phone.slice(-4).padStart(phone.length, '*');
}

function maskBahrainPhone(phone: string) {
  return phone.replace(/^(\+973)(\d{4})(\d{4})$/, '$1****$3');
}

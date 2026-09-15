import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type AppErrorCode =
  | 'BAD_REQUEST'
  | 'ALREADY_CLAIMED'
  | 'CLAIM_NOT_FOUND'
  | 'CLAIM_NOT_ACTIVE'
  | 'CLAIM_ALREADY_VERIFIED'
  | 'CLAIM_EXPIRED'
  | 'DROP_EXPIRED'
  | 'DROP_FULL'
  | 'DROP_INACTIVE'
  | 'DROP_NOT_FOUND'
  | 'INVALID_CLAIM_STATE'
  | 'INVALID_PAYOUT_PHONE'
  | 'INVALID_PIN'
  | 'MINIMUM_SPEND_NOT_MET'
  | 'MISSING_PAYOUT_PHONE'
  | 'PAYOUT_PHONE_IN_USE'
  | 'PIN_LOCKED'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'CONFIGURATION_ERROR'
  | 'INTERNAL_SERVER_ERROR';

export class AppError extends Error {
  constructor(
    public readonly statusCode: ContentfulStatusCode,
    public readonly code: AppErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function jsonError(c: Context, error: AppError) {
  return c.json(
    {
      error: {
        code: error.code,
        message: error.message,
      },
    },
    error.statusCode,
  );
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError(
    500,
    'INTERNAL_SERVER_ERROR',
    'Something went wrong.',
  );
}

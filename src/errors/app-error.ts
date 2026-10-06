import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type AppErrorCode =
  | 'AUTH_REQUIRED'
  | 'ACCOUNT_DELETE_FAILED'
  | 'BAD_REQUEST'
  | 'ALREADY_CLAIMED'
  | 'AMOUNT_BELOW_MINIMUM'
  | 'BENEFITPAY_IN_USE'
  | 'CLAIM_NOT_FOUND'
  | 'CLAIM_NOT_ACTIVE'
  | 'CLAIM_ALREADY_VERIFIED'
  | 'CLAIM_EXPIRED'
  | 'DROP_UNAVAILABLE'
  | 'DROP_EXPIRED'
  | 'DROP_FULL'
  | 'DROP_INACTIVE'
  | 'DROP_NOT_FOUND'
  | 'INVALID_CLAIM_STATE'
  | 'INVALID_PAYOUT_PHONE'
  | 'INVALID_PIN'
  | 'MINIMUM_SPEND_NOT_MET'
  | 'MERCHANT_ALREADY_REDEEMED'
  | 'MERCHANT_CLAIM_ACTIVE'
  | 'MISSING_PAYOUT_PHONE'
  | 'PAYOUT_PHONE_IN_USE'
  | 'PIN_LOCKED'
  | 'PAYOUT_RETENTION_REQUIRED'
  | 'RECEIPT_ALREADY_SUBMITTED'
  | 'RECEIPT_TOO_LARGE'
  | 'RECEIPT_TYPE_INVALID'
  | 'RECEIPT_UPLOAD_NOT_FOUND'
  | 'INVALID_RECEIPT'
  | 'WRONG_VALIDATION_METHOD'
  | 'INVALID_PHONE'
  | 'PHONE_IN_USE'
  | 'PROFILE_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'CONFIGURATION_ERROR'
  | 'INTERNAL_ERROR'
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

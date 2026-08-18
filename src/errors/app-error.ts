import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type AppErrorCode =
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

import type { TarabutApiErrorResponse } from './types';

export class TarabutIntegrationError extends Error {
  public readonly providerStatus?: number;
  public readonly providerError?: string;
  public readonly providerErrorMessage?: string;
  public readonly traceId?: string;
  public readonly details?: unknown[];

  constructor({
    message,
    providerStatus,
    providerError,
    providerErrorMessage,
    traceId,
    details,
  }: {
    message: string;
    providerStatus?: number;
    providerError?: string;
    providerErrorMessage?: string;
    traceId?: string;
    details?: unknown[];
  }) {
    super(message);
    this.name = 'TarabutIntegrationError';
    this.providerStatus = providerStatus;
    this.providerError = providerError;
    this.providerErrorMessage = providerErrorMessage;
    this.traceId = traceId;
    this.details = details;
  }
}

export function createTarabutUpstreamError(
  status: number,
  errorResponse?: TarabutApiErrorResponse,
) {
  return new TarabutIntegrationError({
    message: 'Tarabut authentication request failed.',
    providerStatus: status,
    providerError: errorResponse?.error,
    providerErrorMessage: errorResponse?.errorMessage,
    traceId: errorResponse?.traceId,
    details: errorResponse?.details,
  });
}

export function createMalformedTarabutResponseError() {
  return new TarabutIntegrationError({
    message: 'Tarabut authentication response was malformed.',
  });
}

import { z } from 'zod';

export const tarabutAccessTokenResponseSchema = z.object({
  accessToken: z.string().min(1),
  scope: z.string(),
  expiresIn: z.number().int().positive(),
  tokenType: z.literal('Bearer'),
});

export type TarabutAccessTokenResponse = z.infer<
  typeof tarabutAccessTokenResponseSchema
>;

export const tarabutApiErrorResponseSchema = z
  .object({
    error: z.string().optional(),
    errorMessage: z.string().optional(),
    traceId: z.string().optional(),
    details: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type TarabutApiErrorResponse = z.infer<
  typeof tarabutApiErrorResponseSchema
>;

export type TarabutAccessTokenRequest = {
  scopes?: string;
  redirectUri?: string;
  customerUserId?: string;
};

export type TarabutTokenCacheKeyParts = {
  oauthUrl: string;
  clientId: string;
  scopes?: string;
  redirectUri?: string;
  customerUserId?: string;
};

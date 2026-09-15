import type { User } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../src/errors/app-error';
import { createApp } from '../src/index';
import type { ClaimDto, DropDto, RewardsService } from '../src/services/rewards';

const authUser = {
  id: 'user_123',
  email: 'customer@example.com',
} as User;

const dropDto: DropDto = {
  id: 'drop_123',
  title: 'Coffee reward',
  description: 'Try a new cafe.',
  cashbackAmount: 2.5,
  minimumSpend: 5,
  validationMethod: 'receipt_upload',
  startDate: '2026-09-01T00:00:00.000Z',
  endDate: '2026-09-30T00:00:00.000Z',
  merchant: {
    name: 'Jareb Cafe',
    branch: 'Seef',
    area: 'Manama',
    imageUrl: 'https://example.com/cafe.jpg',
  },
};

const claimDto: ClaimDto = {
  id: 'claim_123',
  dropId: 'drop_123',
  status: 'claimed',
  claimCode: 'ABC123',
  cashbackAmount: 2.5,
  amountSpent: null,
  payoutPhone: null,
  rejectedReason: null,
  claimExpiresAt: '2026-09-22T00:00:00.000Z',
  expiredAt: null,
  drop: dropDto,
};

function createRewardService(overrides: Partial<RewardsService> = {}): RewardsService {
  return {
    listDrops: vi.fn(async () => [dropDto]),
    getDrop: vi.fn(async () => dropDto),
    claimDrop: vi.fn(async () => claimDto),
    listClaims: vi.fn(async () => [claimDto]),
    listActiveClaims: vi.fn(async () => [claimDto]),
    getClaim: vi.fn(async () => claimDto),
    saveClaimPayoutPhone: vi.fn(async () => ({
      ...claimDto,
      payoutPhone: '+97333334444',
    })),
    verifyClaimMerchantPin: vi.fn(async () => ({
      ...claimDto,
      amountSpent: 6.5,
      status: 'visited_pending_review',
    })),
    ...overrides,
  };
}

function createAuthenticatedApp(rewardService = createRewardService()) {
  return createApp({
    getUserFromToken: async () => authUser,
    rewardService,
  });
}

describe('drops and claims API', () => {
  it('requires Supabase bearer authentication', async () => {
    const response = await createApp().request('/drops');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      },
    });
  });

  it('GET /drops returns normalized drops for the authenticated user context', async () => {
    const rewardService = createRewardService();
    const response = await createAuthenticatedApp(rewardService).request(
      '/drops?user_id=attacker',
      {
        headers: {
          Authorization: 'Bearer valid-token',
        },
      },
    );

    expect(response.status).toBe(200);
    expect(rewardService.listDrops).toHaveBeenCalledWith({
      accessToken: 'valid-token',
      bindings: {},
      userId: 'user_123',
    });
    await expect(response.json()).resolves.toEqual({
      drops: [dropDto],
    });
  });

  it('GET /drops/:id returns one normalized drop', async () => {
    const rewardService = createRewardService();
    const response = await createAuthenticatedApp(rewardService).request('/drops/drop_123', {
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });

    expect(response.status).toBe(200);
    expect(rewardService.getDrop).toHaveBeenCalledWith({
      accessToken: 'valid-token',
      bindings: {},
      dropId: 'drop_123',
      userId: 'user_123',
    });
    await expect(response.json()).resolves.toEqual({
      drop: dropDto,
    });
  });

  it('POST /drops/:id/claim wraps claim creation and returns the created claim', async () => {
    const rewardService = createRewardService();
    const response = await createAuthenticatedApp(rewardService).request('/drops/drop_123/claim', {
      headers: {
        Authorization: 'Bearer valid-token',
      },
      method: 'POST',
    });

    expect(response.status).toBe(201);
    expect(rewardService.claimDrop).toHaveBeenCalledWith({
      accessToken: 'valid-token',
      bindings: {},
      dropId: 'drop_123',
      userId: 'user_123',
    });
    await expect(response.json()).resolves.toEqual({
      claim: claimDto,
    });
  });

  it('GET /claims returns only the authenticated user claim context', async () => {
    const rewardService = createRewardService();
    const response = await createAuthenticatedApp(rewardService).request(
      '/claims?user_id=attacker',
      {
        headers: {
          Authorization: 'Bearer valid-token',
        },
      },
    );

    expect(response.status).toBe(200);
    expect(rewardService.listClaims).toHaveBeenCalledWith({
      accessToken: 'valid-token',
      bindings: {},
      userId: 'user_123',
    });
    await expect(response.json()).resolves.toEqual({
      claims: [claimDto],
    });
  });

  it('GET /claims/active returns active authenticated-user claims', async () => {
    const rewardService = createRewardService();
    const response = await createAuthenticatedApp(rewardService).request('/claims/active', {
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });

    expect(response.status).toBe(200);
    expect(rewardService.listActiveClaims).toHaveBeenCalledWith({
      accessToken: 'valid-token',
      bindings: {},
      userId: 'user_123',
    });
    await expect(response.json()).resolves.toEqual({
      claims: [claimDto],
    });
  });

  it('GET /claims/:id returns an authenticated-user claim', async () => {
    const rewardService = createRewardService();
    const response = await createAuthenticatedApp(rewardService).request('/claims/claim_123', {
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });

    expect(response.status).toBe(200);
    expect(rewardService.getClaim).toHaveBeenCalledWith({
      accessToken: 'valid-token',
      bindings: {},
      claimId: 'claim_123',
      userId: 'user_123',
    });
    await expect(response.json()).resolves.toEqual({
      claim: claimDto,
    });
  });

  it('PATCH /claims/:id/payout-phone wraps payout phone saving without accepting user_id', async () => {
    const rewardService = createRewardService();
    const response = await createAuthenticatedApp(rewardService).request(
      '/claims/claim_123/payout-phone',
      {
        body: JSON.stringify({
          payoutPhone: '33334444',
          user_id: 'attacker',
        }),
        headers: {
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        method: 'PATCH',
      },
    );

    expect(response.status).toBe(200);
    expect(rewardService.saveClaimPayoutPhone).toHaveBeenCalledWith({
      accessToken: 'valid-token',
      bindings: {},
      claimId: 'claim_123',
      payoutPhone: '33334444',
      userId: 'user_123',
    });
    await expect(response.json()).resolves.toEqual({
      claim: {
        ...claimDto,
        payoutPhone: '+97333334444',
      },
    });
  });

  it('PATCH /claims/:id/payout-phone rejects missing phone values', async () => {
    const response = await createAuthenticatedApp().request('/claims/claim_123/payout-phone', {
      body: JSON.stringify({}),
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      method: 'PATCH',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'A payoutPhone value is required.',
      },
    });
  });

  it('POST /claims/:id/verify-pin wraps merchant PIN verification without accepting user_id', async () => {
    const rewardService = createRewardService();
    const response = await createAuthenticatedApp(rewardService).request(
      '/claims/claim_123/verify-pin',
      {
        body: JSON.stringify({
          pin: '4821',
          spendAmount: 6.5,
          user_id: 'attacker',
        }),
        headers: {
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      },
    );

    expect(response.status).toBe(200);
    expect(rewardService.verifyClaimMerchantPin).toHaveBeenCalledWith({
      accessToken: 'valid-token',
      bindings: {},
      claimId: 'claim_123',
      pin: '4821',
      spendAmount: 6.5,
      userId: 'user_123',
    });

    const json = await response.json();
    expect(json).toEqual({
      claim: {
        ...claimDto,
        amountSpent: 6.5,
        status: 'visited_pending_review',
      },
    });
    expect(JSON.stringify(json)).not.toContain('4821');
    expect(JSON.stringify(json).toLowerCase()).not.toContain('merchant_pin');
  });

  it('POST /claims/:id/verify-pin rejects invalid request bodies before calling the service', async () => {
    const rewardService = createRewardService();
    const response = await createAuthenticatedApp(rewardService).request(
      '/claims/claim_123/verify-pin',
      {
        body: JSON.stringify({
          pin: '',
          spendAmount: 0,
        }),
        headers: {
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      },
    );

    expect(response.status).toBe(400);
    expect(rewardService.verifyClaimMerchantPin).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'pin and spendAmount are required.',
      },
    });
  });

  it.each([
    [
      'not found',
      new AppError(404, 'DROP_NOT_FOUND', 'Drop not found.'),
      404,
      'DROP_NOT_FOUND',
      'Drop not found.',
    ],
    [
      'inactive',
      new AppError(409, 'DROP_INACTIVE', 'Drop is currently unavailable.'),
      409,
      'DROP_INACTIVE',
      'Drop is currently unavailable.',
    ],
    [
      'full',
      new AppError(409, 'DROP_FULL', 'Drop has been fully claimed.'),
      409,
      'DROP_FULL',
      'Drop has been fully claimed.',
    ],
    [
      'already claimed',
      new AppError(409, 'ALREADY_CLAIMED', 'Active claim already exists.'),
      409,
      'ALREADY_CLAIMED',
      'Active claim already exists.',
    ],
    [
      'expired',
      new AppError(410, 'DROP_EXPIRED', 'Drop is no longer available.'),
      410,
      'DROP_EXPIRED',
      'Drop is no longer available.',
    ],
  ])(
    'POST /drops/:id/claim returns a clear %s error',
    async (_label, error, status, code, message) => {
      const rewardService = createRewardService({
        claimDrop: vi.fn(async () => {
          throw error;
        }),
      });
      const response = await createAuthenticatedApp(rewardService).request('/drops/drop_123/claim', {
        headers: {
          Authorization: 'Bearer valid-token',
        },
        method: 'POST',
      });

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        error: {
          code,
          message,
        },
      });
    },
  );

  it('GET /claims/:id returns not found for claims outside the authenticated account', async () => {
    const rewardService = createRewardService({
      getClaim: vi.fn(async () => {
        throw new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
      }),
    });
    const response = await createAuthenticatedApp(rewardService).request('/claims/claim_other', {
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'CLAIM_NOT_FOUND',
        message: 'Claim not found.',
      },
    });
  });

  it.each([
    [
      'invalid payout phone',
      new AppError(
        400,
        'INVALID_PAYOUT_PHONE',
        'A valid Bahrain BenefitPay number is required.',
      ),
      400,
      'INVALID_PAYOUT_PHONE',
      'A valid Bahrain BenefitPay number is required.',
    ],
    [
      'inactive claim',
      new AppError(409, 'CLAIM_NOT_ACTIVE', 'Claim can no longer be updated.'),
      409,
      'CLAIM_NOT_ACTIVE',
      'Claim can no longer be updated.',
    ],
    [
      'duplicate payout phone',
      new AppError(
        409,
        'PAYOUT_PHONE_IN_USE',
        'This BenefitPay number is already linked to another account.',
      ),
      409,
      'PAYOUT_PHONE_IN_USE',
      'This BenefitPay number is already linked to another account.',
    ],
    [
      'claim not found',
      new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.'),
      404,
      'CLAIM_NOT_FOUND',
      'Claim not found.',
    ],
  ])(
    'PATCH /claims/:id/payout-phone returns a clear %s error',
    async (_label, error, status, code, message) => {
      const rewardService = createRewardService({
        saveClaimPayoutPhone: vi.fn(async () => {
          throw error;
        }),
      });
      const response = await createAuthenticatedApp(rewardService).request(
        '/claims/claim_123/payout-phone',
        {
          body: JSON.stringify({ payoutPhone: '33334444' }),
          headers: {
            Authorization: 'Bearer valid-token',
            'Content-Type': 'application/json',
          },
          method: 'PATCH',
        },
      );

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        error: {
          code,
          message,
        },
      });
    },
  );

  it.each([
    [
      'wrong PIN',
      new AppError(400, 'INVALID_PIN', 'The merchant PIN is incorrect.'),
      400,
      'INVALID_PIN',
      'The merchant PIN is incorrect.',
    ],
    [
      'minimum spend not met',
      new AppError(
        400,
        'MINIMUM_SPEND_NOT_MET',
        'The amount spent does not meet the minimum spend.',
      ),
      400,
      'MINIMUM_SPEND_NOT_MET',
      'The amount spent does not meet the minimum spend.',
    ],
    [
      'expired claim',
      new AppError(410, 'CLAIM_EXPIRED', 'This claim reservation has expired.'),
      410,
      'CLAIM_EXPIRED',
      'This claim reservation has expired.',
    ],
    [
      'already verified claim',
      new AppError(409, 'CLAIM_ALREADY_VERIFIED', 'This claim has already been verified.'),
      409,
      'CLAIM_ALREADY_VERIFIED',
      'This claim has already been verified.',
    ],
    [
      "another user's claim",
      new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.'),
      404,
      'CLAIM_NOT_FOUND',
      'Claim not found.',
    ],
    [
      'PIN lockout',
      new AppError(429, 'PIN_LOCKED', 'Too many incorrect PIN attempts. Try again later.'),
      429,
      'PIN_LOCKED',
      'Too many incorrect PIN attempts. Try again later.',
    ],
  ])(
    'POST /claims/:id/verify-pin returns a clear %s error',
    async (_label, error, status, code, message) => {
      const rewardService = createRewardService({
        verifyClaimMerchantPin: vi.fn(async () => {
          throw error;
        }),
      });
      const response = await createAuthenticatedApp(rewardService).request(
        '/claims/claim_123/verify-pin',
        {
          body: JSON.stringify({ pin: '4821', spendAmount: 6.5 }),
          headers: {
            Authorization: 'Bearer valid-token',
            'Content-Type': 'application/json',
          },
          method: 'POST',
        },
      );

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        error: {
          code,
          message,
        },
      });
    },
  );
});

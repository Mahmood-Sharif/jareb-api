import type { User } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../src/errors/app-error';
import { createApp } from '../src/index';
import {
  toReceiptSubmissionAppError,
  validateReceiptSubmissionRequest,
  type ClaimDto,
  type DropDto,
  type RewardsService,
} from '../src/services/rewards';

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
  maxClaims: 30,
  claimCount: 4,
  remainingCapacity: 26,
  isAvailable: true,
  availabilityStatus: 'available',
  merchant: {
    merchantId: 'merchant_123',
    name: 'Jareb Cafe',
    branch: 'Seef',
    area: 'Manama',
    imageUrl: 'https://example.com/cafe.jpg',
    categories: [
      {
        id: 'category_123',
        nameEn: 'Coffee',
        nameAr: 'Coffee AR',
        slug: 'coffee',
        isPrimary: true,
      },
    ],
  },
  viewer: {
    canClaim: true,
    hasActiveMerchantClaim: false,
    alreadyRedeemedMerchant: false,
    currentClaimId: null,
  },
};

const claimDto: ClaimDto = {
  claimId: 'claim_123',
  id: 'claim_123',
  dropId: 'drop_123',
  status: 'claimed',
  claimCode: 'ABC123',
  claimedAt: '2026-09-21T00:00:00.000Z',
  cashbackAmount: 2.5,
  amountSpent: null,
  payoutPhone: null,
  rejectedReason: null,
  claimExpiresAt: '2026-09-22T00:00:00.000Z',
  expiredAt: null,
  validatedAt: null,
  approvedAt: null,
  paidAt: null,
  validationMethod: 'receipt_upload',
  isExpired: false,
  canClaimAgain: false,
  serverNow: '2026-09-21T12:00:00.000Z',
  drop: {
    id: 'drop_123',
    title: 'Coffee reward',
    description: 'Try a new cafe.',
    cashbackAmount: 2.5,
    minimumSpend: 5,
    validationMethod: 'receipt_upload',
    startDate: '2026-09-01T00:00:00.000Z',
    endDate: '2026-09-30T00:00:00.000Z',
    maxClaims: 30,
    remainingCapacity: 26,
  },
  merchant: dropDto.merchant,
  receipt: null,
};

const serverNow = '2026-09-21T12:00:00.000Z';
const receiptDto = {
  receiptId: 'receipt_123',
  amountSpent: 7.1,
  submittedAt: '2026-09-21T12:01:00.000Z',
  reviewedAt: null,
  rejectionReason: null,
};

function createRewardService(overrides: Partial<RewardsService> = {}): RewardsService {
  return {
    listDrops: vi.fn(async () => ({ drops: [dropDto], serverNow })),
    getDrop: vi.fn(async () => ({ drop: dropDto, serverNow })),
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
    submitClaimReceipt: vi.fn(async () => ({
      serverNow,
      claim: {
        ...claimDto,
        amountSpent: 7.1,
        receipt: receiptDto,
        status: 'receipt_pending_review',
      },
      receipt: receiptDto,
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
      serverNow,
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
      serverNow,
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

  it('POST /claims/:id/receipt wraps receipt finalization without accepting user_id', async () => {
    const rewardService = createRewardService();
    const body = {
      storagePath: 'user_123/claim_123/receipt.jpg',
      originalFilename: 'receipt.jpg',
      mimeType: 'image/jpeg',
      fileSizeBytes: 123456,
      amountSpent: 7.1,
      purchaseDate: '2026-09-21',
      receiptNumber: null,
      customerNote: null,
      user_id: 'attacker',
    };
    const response = await createAuthenticatedApp(rewardService).request(
      '/claims/claim_123/receipt',
      {
        body: JSON.stringify(body),
        headers: {
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      },
    );

    expect(response.status).toBe(200);
    expect(rewardService.submitClaimReceipt).toHaveBeenCalledWith({
      accessToken: 'valid-token',
      bindings: {},
      claimId: 'claim_123',
      receipt: {
        storagePath: 'user_123/claim_123/receipt.jpg',
        originalFilename: 'receipt.jpg',
        mimeType: 'image/jpeg',
        fileSizeBytes: 123456,
        amountSpent: 7.1,
        purchaseDate: '2026-09-21',
        receiptNumber: null,
        customerNote: null,
      },
      userId: 'user_123',
    });
    await expect(response.json()).resolves.toEqual({
      serverNow,
      claim: {
        ...claimDto,
        amountSpent: 7.1,
        receipt: receiptDto,
        status: 'receipt_pending_review',
      },
      receipt: receiptDto,
    });
  });

  it('POST /claims/:id/receipt rejects invalid metadata before calling the service', async () => {
    const rewardService = createRewardService();
    const response = await createAuthenticatedApp(rewardService).request(
      '/claims/claim_123/receipt',
      {
        body: JSON.stringify({
          storagePath: '',
          mimeType: 'image/jpeg',
          amountSpent: 0,
        }),
        headers: {
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      },
    );

    expect(response.status).toBe(400);
    expect(rewardService.submitClaimReceipt).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'Valid receipt metadata is required.',
      },
    });
  });

  it('POST /claims/:id/receipt returns stable finalization errors', async () => {
    const rewardService = createRewardService({
      submitClaimReceipt: vi.fn(async () => {
        throw new AppError(
          409,
          'RECEIPT_ALREADY_SUBMITTED',
          'A receipt has already been submitted for this claim.',
        );
      }),
    });
    const response = await createAuthenticatedApp(rewardService).request(
      '/claims/claim_123/receipt',
      {
        body: JSON.stringify({
          storagePath: 'user_123/claim_123/receipt.jpg',
          originalFilename: 'receipt.jpg',
          mimeType: 'image/jpeg',
          fileSizeBytes: 123456,
          amountSpent: 7.1,
          purchaseDate: '2026-09-21',
        }),
        headers: {
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'RECEIPT_ALREADY_SUBMITTED',
        message: 'A receipt has already been submitted for this claim.',
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
      'merchant already redeemed',
      new AppError(
        409,
        'MERCHANT_ALREADY_REDEEMED',
        "You've already tried this place through Jareb. Discover another reward.",
      ),
      409,
      'MERCHANT_ALREADY_REDEEMED',
      "You've already tried this place through Jareb. Discover another reward.",
    ],
    [
      'merchant claim active',
      new AppError(
        409,
        'MERCHANT_CLAIM_ACTIVE',
        'You already have a reward in progress for this place.',
      ),
      409,
      'MERCHANT_CLAIM_ACTIVE',
      'You already have a reward in progress for this place.',
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

describe('receipt submission boundary', () => {
  const validReceipt = {
    claimId: 'claim_123',
    userId: 'user_123',
    receipt: {
      storagePath: 'user_123/claim_123/receipt.jpg',
      originalFilename: 'receipt.jpg',
      mimeType: 'image/jpeg',
      fileSizeBytes: 123456,
      amountSpent: 7.1,
      purchaseDate: '2026-09-21',
      receiptNumber: null,
      customerNote: null,
    },
  };

  it('validates storage path ownership before finalization', () => {
    expect(() =>
      validateReceiptSubmissionRequest({
        ...validReceipt,
        receipt: {
          ...validReceipt.receipt,
          storagePath: 'attacker/claim_123/receipt.jpg',
        },
      }),
    ).toThrow(
      new AppError(400, 'INVALID_RECEIPT', 'Receipt storage path is invalid.'),
    );
  });

  it.each([
    [
      'invalid MIME',
      {
        ...validReceipt.receipt,
        mimeType: 'application/pdf',
      },
      new AppError(400, 'RECEIPT_TYPE_INVALID', 'Receipt image type is not supported.'),
    ],
    [
      'oversized file',
      {
        ...validReceipt.receipt,
        fileSizeBytes: 5 * 1024 * 1024 + 1,
      },
      new AppError(413, 'RECEIPT_TOO_LARGE', 'Receipt image must be 5 MB or smaller.'),
    ],
    [
      'invalid amount',
      {
        ...validReceipt.receipt,
        amountSpent: 0,
      },
      new AppError(400, 'INVALID_RECEIPT', 'Amount spent must be greater than zero.'),
    ],
    [
      'invalid purchase date',
      {
        ...validReceipt.receipt,
        purchaseDate: 'not-a-date',
      },
      new AppError(400, 'INVALID_RECEIPT', 'Purchase date is invalid.'),
    ],
  ])('rejects %s request metadata', (_label, receipt, expected) => {
    expect(() =>
      validateReceiptSubmissionRequest({
        ...validReceipt,
        receipt,
      }),
    ).toThrow(expected);
  });

  it.each([
    [
      'wrong owner',
      'Claim not found for this account.',
      '42501',
      404,
      'CLAIM_NOT_FOUND',
    ],
    [
      'missing claim',
      'Claim not found.',
      'P0002',
      404,
      'CLAIM_NOT_FOUND',
    ],
    [
      'expired claim',
      'claim_expired',
      'P0001',
      410,
      'CLAIM_EXPIRED',
    ],
    [
      'wrong validation method',
      'This reward does not accept receipt upload.',
      'P0001',
      409,
      'WRONG_VALIDATION_METHOD',
    ],
    [
      'missing payout',
      'Claim needs a payout phone before receipt submission.',
      'P0001',
      409,
      'MISSING_PAYOUT_PHONE',
    ],
    [
      'amount below minimum',
      'Amount spent is below the minimum spend.',
      'P0001',
      400,
      'AMOUNT_BELOW_MINIMUM',
    ],
    [
      'bad MIME',
      'Unsupported receipt file type.',
      '23514',
      400,
      'RECEIPT_TYPE_INVALID',
    ],
    [
      'too large',
      'Receipt file is too large.',
      '23514',
      413,
      'RECEIPT_TOO_LARGE',
    ],
    [
      'storage object missing',
      'Receipt upload was not found.',
      'P0002',
      404,
      'RECEIPT_UPLOAD_NOT_FOUND',
    ],
    [
      'duplicate submission',
      'Receipt already submitted for this claim.',
      '23505',
      409,
      'RECEIPT_ALREADY_SUBMITTED',
    ],
    [
      'drop unavailable',
      'Reward is currently unavailable.',
      'P0001',
      409,
      'DROP_UNAVAILABLE',
    ],
  ])('maps %s without leaking raw Supabase errors', (_label, message, code, status, appCode) => {
    const appError = toReceiptSubmissionAppError({
      code,
      details: 'raw detail',
      hint: 'raw hint',
      message,
      name: 'PostgrestError',
      toJSON: () => ({
        code,
        details: 'raw detail',
        hint: 'raw hint',
        message,
        name: 'PostgrestError',
      }),
    });

    expect(appError.statusCode).toBe(status);
    expect(appError.code).toBe(appCode);
    expect(appError.message.toLowerCase()).not.toContain('raw');
  });
});

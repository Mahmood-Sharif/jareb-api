import type { User } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src';
import { AppError } from '../src/errors/app-error';
import { buildWallet, maskBenefitPayPhone, type WalletService } from '../src/services/wallet';

const authUser = {
  id: 'user_123',
  email: 'customer@example.com',
  aud: 'authenticated',
  role: 'authenticated',
} as User;

const walletDto = {
  cashbackEarned: 3,
  onTheWay: 2.5,
  successfulDropCount: 2,
  payoutMethod: {
    type: 'benefitpay' as const,
    phone: '+97336124521',
    maskedPhone: '+973 **** 4521',
  },
  activity: [
    {
      claimId: 'claim_paid',
      merchantName: 'Dose Dev Café',
      amount: 3,
      status: 'paid' as const,
      eventDate: '2026-10-03T10:00:00.000Z',
    },
    {
      claimId: 'claim_approved',
      merchantName: 'Nomad Dev Bowls',
      amount: 2.5,
      status: 'approved' as const,
      eventDate: '2026-10-02T10:00:00.000Z',
    },
  ],
};

const serverNow = '2026-10-04T10:00:00.000Z';

function createWalletService(overrides: Partial<WalletService> = {}): WalletService {
  return {
    getWallet: vi.fn(async () => ({
      serverNow,
      wallet: walletDto,
    })),
    ...overrides,
  };
}

function createAuthenticatedApp(walletService = createWalletService()) {
  return createApp({
    getUserFromToken: async () => authUser,
    walletService,
  });
}

describe('wallet API', () => {
  it('requires Supabase bearer authentication', async () => {
    const response = await createApp().request('/wallet');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      },
    });
  });

  it('GET /wallet returns only the authenticated user wallet context', async () => {
    const walletService = createWalletService();
    const response = await createAuthenticatedApp(walletService).request(
      '/wallet?user_id=attacker',
      {
        headers: {
          Authorization: 'Bearer valid-token',
        },
      },
    );

    expect(response.status).toBe(200);
    expect(walletService.getWallet).toHaveBeenCalledWith({
      accessToken: 'valid-token',
      bindings: {},
      userId: 'user_123',
    });
    await expect(response.json()).resolves.toEqual({
      serverNow,
      wallet: walletDto,
    });
  });

  it('returns standardized internal errors without raw Supabase details', async () => {
    const walletService = createWalletService({
      getWallet: vi.fn(async () => {
        throw new AppError(500, 'INTERNAL_ERROR', 'Could not load wallet.');
      }),
    });
    const response = await createAuthenticatedApp(walletService).request('/wallet', {
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Could not load wallet.',
      },
    });
  });
});

describe('wallet aggregation', () => {
  it('aggregates paid and approved claims and excludes non-money statuses', () => {
    const wallet = buildWallet({
      payoutPhone: '+97336124521',
      claims: [
        {
          id: 'paid_older',
          status: 'paid',
          cashback_amount: '3.000',
          approved_at: '2026-10-01T10:00:00.000Z',
          paid_at: '2026-10-03T10:00:00.000Z',
          drops: { merchants: { name: 'Dose Dev Café' } },
        },
        {
          id: 'approved_newer',
          status: 'approved',
          cashback_amount: 2.5,
          approved_at: '2026-10-04T10:00:00.000Z',
          paid_at: null,
          drops: { merchants: { name: 'Nomad Dev Bowls' } },
        },
      ],
    });

    expect(wallet.cashbackEarned).toBe(3);
    expect(wallet.onTheWay).toBe(2.5);
    expect(wallet.successfulDropCount).toBe(2);
    expect(wallet.activity.map((item) => item.claimId)).toEqual([
      'approved_newer',
      'paid_older',
    ]);
    expect(wallet.activity[0]).toMatchObject({
      amount: 2.5,
      eventDate: '2026-10-04T10:00:00.000Z',
      status: 'approved',
    });
    expect(wallet.activity[1]).toMatchObject({
      amount: 3,
      eventDate: '2026-10-03T10:00:00.000Z',
      status: 'paid',
    });
  });

  it('handles empty wallets and missing payout phones', () => {
    const wallet = buildWallet({ claims: [], payoutPhone: null });

    expect(wallet).toEqual({
      cashbackEarned: 0,
      onTheWay: 0,
      successfulDropCount: 0,
      payoutMethod: {
        type: 'benefitpay',
        phone: null,
        maskedPhone: null,
      },
      activity: [],
    });
  });

  it('masks payout phone numbers', () => {
    expect(maskBenefitPayPhone('+97336124521')).toBe('+973 **** 4521');
    expect(maskBenefitPayPhone(null)).toBeNull();
  });

  it('fails safely when approved or paid rows are missing event dates', () => {
    expect(() =>
      buildWallet({
        payoutPhone: '+97336124521',
        claims: [
          {
            id: 'bad_approved',
            status: 'approved',
            cashback_amount: 2.5,
            approved_at: null,
            paid_at: null,
          },
        ],
      }),
    ).toThrow(AppError);

    expect(() =>
      buildWallet({
        payoutPhone: '+97336124521',
        claims: [
          {
            id: 'bad_paid',
            status: 'paid',
            cashback_amount: 2.5,
            approved_at: '2026-10-01T10:00:00.000Z',
            paid_at: null,
          },
        ],
      }),
    ).toThrow(AppError);
  });
});

import type { PostgrestError } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../src/errors/app-error';
import { createSupabaseUserClient } from '../src/services/supabase';
import { rewardsService } from '../src/services/rewards';

vi.mock('../src/services/supabase', () => ({
  createSupabaseUserClient: vi.fn(),
}));

const context = {
  accessToken: 'valid-token',
  bindings: {
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_URL: 'http://127.0.0.1:54321',
  },
  userId: 'user_123',
};

const merchantCategories = [
  {
    merchant_id: 'merchant_123',
    is_primary: true,
    sort_order: 1,
    categories: {
      id: 'category_123',
      name_en: 'Coffee',
      name_ar: 'Coffee AR',
      slug: 'coffee',
      is_active: true,
    },
  },
];

const customerDrop = {
  id: 'drop_123',
  merchant_id: 'merchant_123',
  title: 'Coffee reward',
  description: 'Try a new cafe.',
  cashback_amount: 2.5,
  minimum_spend: 5,
  validation_method: 'receipt_upload',
  start_date: '2026-09-01T00:00:00.000Z',
  end_date: '2099-09-30T00:00:00.000Z',
  max_claims: 30,
  claim_count: 4,
  remaining_capacity: 26,
  is_active: true,
  merchant_name: 'Jareb Cafe',
  merchant_branch: 'Seef',
  merchant_area: 'Manama',
  merchant_image_url: 'https://example.com/cafe.jpg',
  merchant_is_active: true,
  merchant_relationship_status: 'active',
  has_active_merchant_claim: false,
  already_redeemed_merchant: false,
  current_claim_id: null,
};

const claimedClaim = {
  id: 'claim_123',
  user_id: 'user_123',
  drop_id: 'drop_123',
  status: 'claimed',
  claim_code: 'ABC123',
  claimed_at: '2026-09-21T00:00:00.000Z',
  cashback_amount: 2.5,
  amount_spent: null,
  payout_phone: '+97333334444',
  rejected_reason: null,
  claim_expires_at: '2099-09-22T00:00:00.000Z',
  expired_at: null,
  validated_at: null,
  approved_at: null,
  paid_at: null,
};

const receipt = {
  claim_id: 'claim_receipt',
  id: 'receipt_123',
  amount_spent: 7.1,
  created_at: '2026-09-21T12:01:00.000Z',
  reviewed_at: null,
  rejection_reason: null,
};

beforeEach(() => {
  vi.mocked(createSupabaseUserClient).mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('rewards service claim hydration', () => {
  it('listDrops returns active available Drops for a fresh eligible user', async () => {
    vi.mocked(createSupabaseUserClient).mockReturnValue(
      createFakeSupabaseClient({
        listDrops: [customerDrop],
      }) as never,
    );

    const result = await rewardsService.listDrops({
      ...context,
      userId: '10000000-0000-0000-0000-000000000001',
    });

    expect(result.drops).toHaveLength(1);
    expect(result.drops[0]).toMatchObject({
      id: 'drop_123',
      title: 'Coffee reward',
      remainingCapacity: 26,
      isAvailable: true,
      availabilityStatus: 'available',
      viewer: {
        canClaim: true,
        hasActiveMerchantClaim: false,
        alreadyRedeemedMerchant: false,
        currentClaimId: null,
      },
      merchant: {
        merchantId: 'merchant_123',
        name: 'Jareb Cafe',
        area: 'Manama',
      },
    });
  });

  it('listClaims hydrates current ClaimDto with nullable receipt metadata', async () => {
    vi.mocked(createSupabaseUserClient).mockReturnValue(
      createFakeSupabaseClient({
        claims: [claimedClaim],
      }) as never,
    );

    const claims = await rewardsService.listClaims(context);

    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      claimId: 'claim_123',
      id: 'claim_123',
      dropId: 'drop_123',
      status: 'claimed',
      cashbackAmount: 2.5,
      payoutPhone: '+97333334444',
      validationMethod: 'receipt_upload',
      receipt: null,
      drop: {
        id: 'drop_123',
        minimumSpend: 5,
        cashbackAmount: 2.5,
        validationMethod: 'receipt_upload',
      },
      merchant: {
        merchantId: 'merchant_123',
        name: 'Jareb Cafe',
        categories: [
          {
            id: 'category_123',
            slug: 'coffee',
            isPrimary: true,
          },
        ],
      },
    });
  });

  it('loadOwnedClaim hydrates current ClaimDto with receipt metadata present', async () => {
    vi.mocked(createSupabaseUserClient).mockReturnValue(
      createFakeSupabaseClient({
        claims: [
          {
            ...claimedClaim,
            id: 'claim_receipt',
            status: 'receipt_pending_review',
            amount_spent: 7.1,
            validated_at: '2026-09-21T12:01:00.000Z',
          },
        ],
        receipts: [receipt],
      }) as never,
    );

    const claim = await rewardsService.getClaim({
      ...context,
      claimId: 'claim_receipt',
    });

    expect(claim.status).toBe('receipt_pending_review');
    expect(claim.receipt).toEqual({
      receiptId: 'receipt_123',
      amountSpent: 7.1,
      submittedAt: '2026-09-21T12:01:00.000Z',
      reviewedAt: null,
      rejectionReason: null,
    });
  });

  it('claimDrop hydrates the created claim through the shared path', async () => {
    vi.mocked(createSupabaseUserClient).mockReturnValue(
      createFakeSupabaseClient({
        claimDropResult: { claim_id: 'claim_123', claim_status: 'claimed' },
        claims: [claimedClaim],
      }) as never,
    );

    const claim = await rewardsService.claimDrop({
      ...context,
      dropId: 'drop_123',
    });

    expect(claim.claimId).toBe('claim_123');
    expect(claim.status).toBe('claimed');
    expect(claim.drop?.minimumSpend).toBe(5);
  });

  it('GET /claims includes claimed, approved, paid, rejected, expired, and pending review states', async () => {
    const statusRows = [
      claimedClaim,
      {
        ...claimedClaim,
        id: 'claim_approved',
        status: 'approved',
        approved_at: '2026-09-21T12:00:00.000Z',
      },
      {
        ...claimedClaim,
        id: 'claim_paid',
        status: 'paid',
        paid_at: '2026-09-22T12:00:00.000Z',
      },
      {
        ...claimedClaim,
        id: 'claim_rejected',
        status: 'rejected',
        rejected_reason: 'Receipt unreadable.',
      },
      {
        ...claimedClaim,
        id: 'claim_expired',
        status: 'expired',
        expired_at: '2026-09-23T12:00:00.000Z',
      },
      {
        ...claimedClaim,
        id: 'claim_receipt_review',
        status: 'receipt_pending_review',
      },
      {
        ...claimedClaim,
        id: 'claim_visit_review',
        status: 'visited_pending_review',
      },
    ];
    vi.mocked(createSupabaseUserClient).mockReturnValue(
      createFakeSupabaseClient({
        claims: statusRows,
      }) as never,
    );

    const claims = await rewardsService.listClaims(context);

    expect(claims.map((claim) => claim.status)).toEqual([
      'claimed',
      'approved',
      'paid',
      'rejected',
      'expired',
      'receipt_pending_review',
      'visited_pending_review',
    ]);
  });

  it('backend database errors remain INTERNAL_ERROR to clients while logging Supabase details', async () => {
    const error = postgrestError({
      code: 'PGRST200',
      message: "Could not find a relationship between 'claims' and 'claim_receipts'",
      details: 'Searched for a foreign key relationship in the schema cache.',
      hint: 'Try changing claim_receipts to claim_receipts!claim_receipts_claim_id_fkey.',
    });
    vi.mocked(createSupabaseUserClient).mockReturnValue(
      createFakeSupabaseClient({
        claimsError: error,
      }) as never,
    );

    await expect(rewardsService.listClaims(context)).rejects.toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Could not load claims.',
    });
    expect(console.error).toHaveBeenCalledWith(
      'Unexpected Supabase error',
      expect.objectContaining({
        operation: 'listClaims.selectClaims',
        code: 'PGRST200',
        message: error.message,
      }),
    );
  });

  it('duplicate claim protection still maps to 409', async () => {
    vi.mocked(createSupabaseUserClient).mockReturnValue(
      createFakeSupabaseClient({
        claimDropError: postgrestError({
          code: '23505',
          message: 'existing active claim',
        }),
      }) as never,
    );

    await expect(
      rewardsService.claimDrop({
        ...context,
        dropId: 'drop_123',
      }),
    ).rejects.toEqual(new AppError(409, 'MERCHANT_CLAIM_ACTIVE', 'Active claim already exists.'));
  });
});

function createFakeSupabaseClient({
  categories = merchantCategories,
  claimDropError = null,
  claimDropResult = null,
  claims = [],
  claimsError = null,
  listDrops = [],
  drops = [customerDrop],
  receipts = [],
  receiptsError = null,
}: {
  categories?: unknown[];
  claimDropError?: PostgrestError | null;
  claimDropResult?: unknown;
  claims?: unknown[];
  claimsError?: PostgrestError | null;
  listDrops?: unknown[];
  drops?: unknown[];
  receipts?: unknown[];
  receiptsError?: PostgrestError | null;
}) {
  return {
    rpc: vi.fn(async (name: string, params?: Record<string, unknown>) => {
      if (name === 'list_available_drops') {
        return { data: listDrops, error: null };
      }

      if (name === 'claim_drop') {
        return { data: claimDropResult, error: claimDropError };
      }

      if (name === 'get_customer_drop') {
        return {
          data: drops.find((drop) => readProperty(drop, 'id') === params?.input_drop_id) ?? null,
          error: null,
        };
      }

      return { data: null, error: null };
    }),
    from: vi.fn((table: string) => {
      if (table === 'claims') {
        return createClaimsQuery(claims, claimsError);
      }

      if (table === 'claim_receipts') {
        return createReceiptQuery(receipts, receiptsError);
      }

      if (table === 'merchant_categories') {
        return createCategoryQuery(categories);
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  };
}

function createClaimsQuery(rows: unknown[], error: PostgrestError | null) {
  const filters = new Map<string, unknown>();
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((column: string, value: unknown) => {
      filters.set(column, value);
      return query;
    }),
    in: vi.fn(() => query),
    order: vi.fn(async () => ({ data: filterRows(rows, filters), error })),
    maybeSingle: vi.fn(async () => ({
      data: filterRows(rows, filters)[0] ?? null,
      error,
    })),
  };
  return query;
}

function createReceiptQuery(rows: unknown[], error: PostgrestError | null) {
  const query = {
    select: vi.fn(() => query),
    in: vi.fn(async (_column: string, values: string[]) => ({
      data: rows.filter((row) => values.includes(String(readProperty(row, 'claim_id')))),
      error,
    })),
  };
  return query;
}

function createCategoryQuery(rows: unknown[]) {
  let orderCount = 0;
  const query = {
    select: vi.fn(() => query),
    in: vi.fn(() => query),
    order: vi.fn(() => {
      orderCount += 1;
      if (orderCount < 2) {
        return query;
      }
      return Promise.resolve({ data: rows, error: null });
    }),
  };
  return query;
}

function filterRows(rows: unknown[], filters: Map<string, unknown>) {
  return rows.filter((row) =>
    [...filters.entries()].every(([column, value]) => readProperty(row, column) === value),
  );
}

function readProperty(row: unknown, property: string) {
  return (row as Record<string, unknown>)[property];
}

function postgrestError({
  code,
  details = '',
  hint = '',
  message,
}: {
  code: string;
  details?: string;
  hint?: string;
  message: string;
}): PostgrestError {
  const error = {
    code,
    details,
    hint,
    message,
    name: 'PostgrestError',
  };
  return {
    ...error,
    toJSON: () => error,
  };
}

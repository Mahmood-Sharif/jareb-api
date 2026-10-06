import type { User } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src';
import { AppError } from '../src/errors/app-error';
import type { DropDto } from '../src/services/rewards';
import {
  sortSavedDrops,
  type SavedDropDto,
  type SavedDropsService,
} from '../src/services/saved-drops';

const authUser = {
  id: 'user_123',
  email: 'customer@example.com',
} as User;

const serverNow = '2026-10-04T10:00:00.000Z';
const liveSavedAt = '2026-10-04T09:00:00.000Z';
const unavailableSavedAt = '2026-10-04T09:30:00.000Z';

const liveDrop = createDropDto({
  id: 'drop_live',
  availabilityStatus: 'available',
  canClaim: true,
});
const endedDrop = createDropDto({
  id: 'drop_ended',
  availabilityStatus: 'ended',
  availabilityReason: 'ended',
  canClaim: false,
  isAvailable: false,
});

function createSavedDropsService(
  overrides: Partial<SavedDropsService> = {},
): SavedDropsService {
  return {
    listSavedDrops: vi.fn(async () => ({
      serverNow,
      savedDrops: [
        {
          savedAt: liveSavedAt,
          drop: liveDrop,
        },
        {
          savedAt: unavailableSavedAt,
          drop: endedDrop,
        },
      ],
    })),
    saveDrop: vi.fn(async ({ dropId }) => ({
      serverNow,
      savedDrop: {
        savedAt: liveSavedAt,
        drop: createDropDto({ id: dropId }),
      },
    })),
    unsaveDrop: vi.fn(async ({ dropId }) => ({
      deleted: true as const,
      dropId,
    })),
    ...overrides,
  };
}

function createAuthenticatedApp(service = createSavedDropsService()) {
  return createApp({
    getUserFromToken: async () => authUser,
    savedDropsService: service,
  });
}

describe('saved drops API', () => {
  it('requires Supabase bearer authentication', async () => {
    const response = await createApp().request('/saved-drops');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      },
    });
  });

  it('GET /saved-drops uses only the authenticated user context', async () => {
    const service = createSavedDropsService();
    const response = await createAuthenticatedApp(service).request(
      '/saved-drops?user_id=attacker',
      {
        headers: {
          Authorization: 'Bearer valid-token',
        },
      },
    );

    expect(response.status).toBe(200);
    expect(service.listSavedDrops).toHaveBeenCalledWith({
      accessToken: 'valid-token',
      bindings: {},
      userId: 'user_123',
    });
    await expect(response.json()).resolves.toEqual({
      serverNow,
      savedDrops: [
        {
          savedAt: liveSavedAt,
          drop: liveDrop,
        },
        {
          savedAt: unavailableSavedAt,
          drop: endedDrop,
        },
      ],
    });
  });

  it('POST /saved-drops/:dropId saves idempotently through the service', async () => {
    const service = createSavedDropsService();
    const response = await createAuthenticatedApp(service).request(
      '/saved-drops/drop_live',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-token',
        },
      },
    );

    expect(response.status).toBe(201);
    expect(service.saveDrop).toHaveBeenCalledWith({
      accessToken: 'valid-token',
      bindings: {},
      dropId: 'drop_live',
      userId: 'user_123',
    });
    await expect(response.json()).resolves.toEqual({
      serverNow,
      savedDrop: {
        savedAt: liveSavedAt,
        drop: createDropDto({ id: 'drop_live' }),
      },
    });
  });

  it('DELETE /saved-drops/:dropId is idempotent', async () => {
    const service = createSavedDropsService();
    const response = await createAuthenticatedApp(service).request(
      '/saved-drops/drop_live',
      {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer valid-token',
        },
      },
    );

    expect(response.status).toBe(200);
    expect(service.unsaveDrop).toHaveBeenCalledWith({
      accessToken: 'valid-token',
      bindings: {},
      dropId: 'drop_live',
      userId: 'user_123',
    });
    await expect(response.json()).resolves.toEqual({
      deleted: true,
      dropId: 'drop_live',
    });
  });

  it('surfaces missing drops with the stable error envelope', async () => {
    const service = createSavedDropsService({
      saveDrop: vi.fn(async () => {
        throw new AppError(404, 'DROP_NOT_FOUND', 'Drop not found.');
      }),
    });
    const response = await createAuthenticatedApp(service).request(
      '/saved-drops/missing',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-token',
        },
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'DROP_NOT_FOUND',
        message: 'Drop not found.',
      },
    });
  });
});

describe('saved drops ordering', () => {
  it('keeps unavailable saved drops visible after claimable saved drops', () => {
    const sorted = sortSavedDrops([
      {
        savedAt: '2026-10-04T10:00:00.000Z',
        drop: createDropDto({
          id: 'drop_full',
          availabilityStatus: 'full',
          availabilityReason: 'full',
          canClaim: false,
          isAvailable: false,
        }),
      },
      {
        savedAt: '2026-10-04T09:00:00.000Z',
        drop: createDropDto({ id: 'drop_live_old', canClaim: true }),
      },
      {
        savedAt: '2026-10-04T11:00:00.000Z',
        drop: createDropDto({ id: 'drop_live_new', canClaim: true }),
      },
      {
        savedAt: '2026-10-04T12:00:00.000Z',
        drop: createDropDto({
          id: 'drop_redeemed',
          availabilityStatus: 'merchant_already_redeemed',
          availabilityReason: 'merchant_already_redeemed',
          canClaim: false,
        }),
      },
      {
        savedAt: '2026-10-04T08:00:00.000Z',
        drop: createDropDto({
          id: 'drop_active_claim',
          availabilityStatus: 'merchant_claim_active',
          availabilityReason: 'merchant_claim_active',
          canClaim: false,
        }),
      },
    ]);

    expect(sorted.map((item) => item.drop.id)).toEqual([
      'drop_live_new',
      'drop_live_old',
      'drop_redeemed',
      'drop_full',
      'drop_active_claim',
    ]);
  });
});

function createDropDto({
  id,
  availabilityStatus = 'available',
  availabilityReason,
  canClaim = true,
  isAvailable = true,
}: {
  id: string;
  availabilityStatus?: DropDto['availabilityStatus'];
  availabilityReason?: DropDto['availabilityReason'];
  canClaim?: boolean;
  isAvailable?: boolean;
}): DropDto {
  return {
    id,
    title: 'Saved test drop',
    description: 'Saved drop fixture.',
    cashbackAmount: 2.5,
    minimumSpend: 6,
    validationMethod: 'merchant_pin',
    startDate: '2026-10-01T00:00:00.000Z',
    endDate: '2026-10-31T00:00:00.000Z',
    maxClaims: 30,
    claimCount: 4,
    remainingCapacity: isAvailable ? 26 : 0,
    isAvailable,
    availabilityStatus,
    availabilityReason,
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
      canClaim,
      hasActiveMerchantClaim: availabilityStatus === 'merchant_claim_active',
      alreadyRedeemedMerchant: availabilityStatus === 'merchant_already_redeemed',
      currentClaimId: null,
    },
  };
}

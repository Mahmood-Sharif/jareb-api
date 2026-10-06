import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseAuthConfig } from '../config/env';
import { AppError } from '../errors/app-error';
import { createSupabaseUserClient } from './supabase';
import type { Bindings } from '../types/app';

const ACTIVE_CLAIM_STATUSES = [
  'claimed',
  'receipt_pending_review',
  'visited_pending_review',
  'approved',
] as const;

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const ALLOWED_RECEIPT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type CategoryRow = {
  id: string;
  name_en: string;
  name_ar: string;
  slug: string;
  is_active?: boolean | null;
};

type MerchantCategoryRow = {
  merchant_id: string;
  is_primary: boolean | null;
  sort_order: number | null;
  categories?: CategoryRow | CategoryRow[] | null;
};

type MerchantRow = {
  id?: string | null;
  name: string | null;
  branch: string | null;
  area: string | null;
  merchant_image_url?: string | null;
  is_active?: boolean | null;
  relationship_status?: string | null;
};

export type DropRow = {
  id: string;
  title: string;
  description: string | null;
  cashback_amount: number | string;
  minimum_spend: number | string;
  validation_method: string | null;
  start_date: string | null;
  end_date: string | null;
  max_claims?: number | string | null;
  claim_count?: number | string | null;
  active_claim_count?: number | string | null;
  remaining_capacity?: number | string | null;
  is_active?: boolean | null;
  claim_validity_hours?: number | string | null;
  merchant_id?: string | null;
  merchant_name?: string | null;
  merchant_branch?: string | null;
  merchant_area?: string | null;
  merchant_image_url?: string | null;
  merchant_is_active?: boolean | null;
  merchant_relationship_status?: string | null;
  has_active_merchant_claim?: boolean | null;
  already_redeemed_merchant?: boolean | null;
  current_claim_id?: string | null;
  merchants?: MerchantRow | MerchantRow[] | null;
};

type ReceiptRow = {
  id: string;
  claim_id?: string | null;
  amount_spent: number | string | null;
  created_at: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
};

type ClaimRow = {
  id: string;
  drop_id: string;
  status: string;
  claim_code: string | null;
  claimed_at: string | null;
  cashback_amount: number | string | null;
  amount_spent: number | string | null;
  payout_phone: string | null;
  rejected_reason: string | null;
  claim_expires_at: string | null;
  expired_at: string | null;
  validated_at: string | null;
  approved_at: string | null;
  paid_at: string | null;
  drops?: DropRow | DropRow[] | null;
  claim_receipts?: ReceiptRow | ReceiptRow[] | null;
};

type ClaimDropResult = {
  claim_id: string;
  claim_status: string;
};

type SavePayoutResult = {
  saved_payout_phone: string;
};

type MerchantPinValidationResult = {
  validation_succeeded: boolean;
  claim_id: string | null;
  claim_status: string | null;
  error_code: string | null;
};

type SubmitReceiptResult = {
  claim_id: string;
  claim_status: string;
};

export type MerchantCategoryDto = {
  id: string;
  nameEn: string;
  nameAr: string;
  slug: string;
  isPrimary: boolean;
};

export type MerchantDto = {
  merchantId: string | null;
  name: string | null;
  branch: string | null;
  area: string | null;
  imageUrl: string | null;
  categories: MerchantCategoryDto[];
};

export type DropViewerDto = {
  canClaim: boolean;
  hasActiveMerchantClaim: boolean;
  alreadyRedeemedMerchant: boolean;
  currentClaimId: string | null;
};

export type AvailabilityStatus =
  | 'available'
  | 'upcoming'
  | 'ended'
  | 'inactive'
  | 'merchant_inactive'
  | 'full'
  | 'merchant_claim_active'
  | 'merchant_already_redeemed';

export type DropDto = {
  id: string;
  title: string;
  description: string | null;
  cashbackAmount: number;
  minimumSpend: number;
  validationMethod: string | null;
  startDate: string | null;
  endDate: string | null;
  maxClaims: number | null;
  claimCount: number;
  remainingCapacity: number | null;
  isAvailable: boolean;
  availabilityStatus: AvailabilityStatus;
  availabilityReason?: AvailabilityStatus;
  claimValidityHours?: number | null;
  merchant: MerchantDto | null;
  viewer: DropViewerDto;
};

export type ClaimReceiptDto = {
  receiptId: string;
  amountSpent: number | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
};

export type SubmitReceiptInput = {
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  amountSpent: number;
  purchaseDate: string;
  receiptNumber?: string | null;
  customerNote?: string | null;
};

export type ClaimDropDto = {
  id: string;
  title: string;
  description: string | null;
  cashbackAmount: number;
  minimumSpend: number;
  validationMethod: string | null;
  startDate: string | null;
  endDate: string | null;
  maxClaims: number | null;
  remainingCapacity: number | null;
};

export type ClaimDto = {
  claimId: string;
  id: string;
  dropId: string;
  status: string;
  claimCode: string | null;
  claimedAt: string | null;
  claimExpiresAt: string | null;
  expiredAt: string | null;
  validatedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  rejectedReason: string | null;
  amountSpent: number | null;
  cashbackAmount: number | null;
  payoutPhone: string | null;
  validationMethod: string | null;
  isExpired: boolean;
  canClaimAgain: boolean;
  serverNow: string;
  drop: ClaimDropDto | null;
  merchant: MerchantDto | null;
  receipt?: ClaimReceiptDto | null;
};

export type RewardsServiceContext = {
  accessToken: string;
  bindings: Bindings;
  userId: string;
};

export type RewardsService = {
  listDrops(context: RewardsServiceContext): Promise<{ drops: DropDto[]; serverNow: string }>;
  getDrop(
    context: RewardsServiceContext & { dropId: string },
  ): Promise<{ drop: DropDto; serverNow: string }>;
  claimDrop(context: RewardsServiceContext & { dropId: string }): Promise<ClaimDto>;
  listClaims(context: RewardsServiceContext): Promise<ClaimDto[]>;
  listActiveClaims(context: RewardsServiceContext): Promise<ClaimDto[]>;
  getClaim(context: RewardsServiceContext & { claimId: string }): Promise<ClaimDto>;
  saveClaimPayoutPhone(
    context: RewardsServiceContext & { claimId: string; payoutPhone: string },
  ): Promise<ClaimDto>;
  verifyClaimMerchantPin(
    context: RewardsServiceContext & {
      claimId: string;
      pin: string;
      spendAmount: number;
    },
  ): Promise<ClaimDto>;
  submitClaimReceipt(
    context: RewardsServiceContext & { claimId: string; receipt: SubmitReceiptInput },
  ): Promise<{ claim: ClaimDto; receipt: ClaimReceiptDto; serverNow: string }>;
};

const CLAIM_SELECT =
  'id, drop_id, status, claim_code, claimed_at, cashback_amount, amount_spent, payout_phone, rejected_reason, claim_expires_at, expired_at, validated_at, approved_at, paid_at';

const CLAIM_RECEIPT_SELECT = 'claim_id, id, amount_spent, created_at, reviewed_at, rejection_reason';

function createClient({ accessToken, bindings }: RewardsServiceContext) {
  return createSupabaseUserClient({
    ...getSupabaseAuthConfig(bindings),
    accessToken,
  });
}

export const rewardsService: RewardsService = {
  async listDrops(context) {
    const supabase = createClient(context);
    const serverNow = new Date().toISOString();

    const { data, error } = await supabase.rpc('list_available_drops');

    if (error) {
      logSupabaseError('listDrops.list_available_drops', error);
      throw new AppError(500, 'INTERNAL_ERROR', 'Could not load drops.');
    }

    const rows = ((data ?? []) as DropRow[]).filter((row) => {
      const remaining = nullableNumber(row.remaining_capacity);
      return remaining === null || remaining > 0;
    });
    const categoriesByMerchant = await loadCategoriesByMerchantId(
      supabase,
      merchantIdsFromDropRows(rows),
    );

    return {
      drops: rows.map((row) =>
        toDropDto(row, {
          categoriesByMerchant,
          detail: false,
          serverNow,
        }),
      ),
      serverNow,
    };
  },

  async getDrop(context) {
    const supabase = createClient(context);
    const serverNow = new Date().toISOString();
    const row = await loadCustomerDrop({
      dropId: context.dropId,
      supabase,
    });

    const categoriesByMerchant = await loadCategoriesByMerchantId(
      supabase,
      merchantIdsFromDropRows([row]),
    );

    return {
      drop: toDropDto(row, {
        categoriesByMerchant,
        detail: true,
        serverNow,
      }),
      serverNow,
    };
  },

  async claimDrop(context) {
    const supabase = createClient(context);
    const { data, error } = await supabase.rpc('claim_drop', {
      input_drop_id: context.dropId,
    });

    if (error) {
      throw toClaimDropAppError(error);
    }

    const result = firstRow<ClaimDropResult>(data);

    if (!result?.claim_id) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Could not create claim.');
    }

    return loadOwnedClaim({
      claimId: result.claim_id,
      supabase,
      userId: context.userId,
    });
  },

  async listClaims(context) {
    const supabase = createClient(context);
    const { data, error } = await supabase
      .from('claims')
      .select(CLAIM_SELECT)
      .eq('user_id', context.userId)
      .order('claimed_at', { ascending: false });

    if (error) {
      logSupabaseError('listClaims.selectClaims', error);
      throw new AppError(500, 'INTERNAL_ERROR', 'Could not load claims.');
    }

    return hydrateClaimDtos({
      rows: (data ?? []) as ClaimRow[],
      supabase,
    });
  },

  async listActiveClaims(context) {
    const supabase = createClient(context);
    const { data, error } = await supabase
      .from('claims')
      .select(CLAIM_SELECT)
      .eq('user_id', context.userId)
      .in('status', [...ACTIVE_CLAIM_STATUSES])
      .order('claimed_at', { ascending: false });

    if (error) {
      logSupabaseError('listActiveClaims.selectClaims', error);
      throw new AppError(500, 'INTERNAL_ERROR', 'Could not load active claims.');
    }

    return hydrateClaimDtos({
      rows: ((data ?? []) as ClaimRow[]).filter((claim) =>
        isClaimActive(claim.status, claim.claim_expires_at),
      ),
      supabase,
    });
  },

  async getClaim(context) {
    const supabase = createClient(context);
    return loadOwnedClaim({
      claimId: context.claimId,
      supabase,
      userId: context.userId,
    });
  },

  async saveClaimPayoutPhone(context) {
    const supabase = createClient(context);
    const { data, error } = await supabase.rpc('save_my_claim_payout_phone', {
      input_claim_id: context.claimId,
      input_payout_phone: context.payoutPhone,
    });

    if (error) {
      throw toPayoutPhoneAppError(error);
    }

    const result = firstRow<SavePayoutResult>(data);

    if (!result?.saved_payout_phone) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Could not save payout phone.');
    }

    return loadOwnedClaim({
      claimId: context.claimId,
      supabase,
      userId: context.userId,
    });
  },

  async verifyClaimMerchantPin(context) {
    const supabase = createClient(context);
    const { data, error } = await supabase.rpc('validate_claim_with_merchant_pin', {
      input_claim_id: context.claimId,
      input_pin: context.pin,
      input_amount_spent: context.spendAmount,
    });

    if (error) {
      throw toMerchantPinRpcAppError(error);
    }

    const result = firstRow<MerchantPinValidationResult>(data);

    if (!result) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Could not verify merchant PIN.');
    }

    if (!result.validation_succeeded) {
      throw toMerchantPinValidationAppError(result.error_code);
    }

    if (!result.claim_id) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Could not verify merchant PIN.');
    }

    return loadOwnedClaim({
      claimId: result.claim_id,
      supabase,
      userId: context.userId,
    });
  },

  async submitClaimReceipt(context) {
    validateReceiptSubmissionRequest(context);
    const supabase = createClient(context);
    const { data, error } = await supabase.rpc('submit_claim_receipt', {
      input_claim_id: context.claimId,
      input_storage_path: context.receipt.storagePath,
      input_original_filename: context.receipt.originalFilename,
      input_mime_type: context.receipt.mimeType,
      input_file_size_bytes: context.receipt.fileSizeBytes,
      input_amount_spent: context.receipt.amountSpent,
      input_purchase_date: context.receipt.purchaseDate,
      input_receipt_number: context.receipt.receiptNumber ?? null,
      input_customer_note: context.receipt.customerNote ?? null,
    });

    if (error) {
      throw toReceiptSubmissionAppError(error);
    }

    const result = firstRow<SubmitReceiptResult>(data);
    if (!result?.claim_id) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Could not submit receipt.');
    }

    const claim = await loadOwnedClaim({
      claimId: result.claim_id,
      supabase,
      userId: context.userId,
    });

    if (!claim.receipt) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Could not load receipt.');
    }

    return {
      serverNow: new Date().toISOString(),
      claim,
      receipt: claim.receipt,
    };
  },
};

export function validateReceiptSubmissionRequest({
  claimId,
  receipt,
  userId,
}: {
  claimId: string;
  receipt: SubmitReceiptInput;
  userId: string;
}) {
  if (!ALLOWED_RECEIPT_MIME_TYPES.has(receipt.mimeType)) {
    throw new AppError(400, 'RECEIPT_TYPE_INVALID', 'Receipt image type is not supported.');
  }

  if (!Number.isFinite(receipt.fileSizeBytes) || receipt.fileSizeBytes <= 0) {
    throw new AppError(400, 'INVALID_RECEIPT', 'Receipt file is invalid.');
  }

  if (receipt.fileSizeBytes > MAX_RECEIPT_BYTES) {
    throw new AppError(413, 'RECEIPT_TOO_LARGE', 'Receipt image must be 5 MB or smaller.');
  }

  if (!Number.isFinite(receipt.amountSpent) || receipt.amountSpent <= 0) {
    throw new AppError(400, 'INVALID_RECEIPT', 'Amount spent must be greater than zero.');
  }

  if (!isIsoDate(receipt.purchaseDate)) {
    throw new AppError(400, 'INVALID_RECEIPT', 'Purchase date is invalid.');
  }

  const expectedPrefix = `${userId}/${claimId}/`;
  if (
    !receipt.storagePath.startsWith(expectedPrefix) ||
    receipt.storagePath.includes('..') ||
    receipt.storagePath.endsWith('/')
  ) {
    throw new AppError(400, 'INVALID_RECEIPT', 'Receipt storage path is invalid.');
  }
}

async function loadOwnedClaim({
  claimId,
  supabase,
  userId,
}: {
  claimId: string;
  supabase: SupabaseClient;
  userId: string;
}) {
  const { data, error } = await supabase
    .from('claims')
    .select(CLAIM_SELECT)
    .eq('id', claimId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    logSupabaseError('loadOwnedClaim.selectClaim', error);
    throw new AppError(500, 'INTERNAL_ERROR', 'Could not load claim.');
  }

  if (!data) {
    throw new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
  }

  const [claim] = await hydrateClaimDtos({
    rows: [data as ClaimRow],
    supabase,
  });

  if (!claim) {
    throw new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
  }

  return claim;
}

async function hydrateClaimDtos({
  rows,
  supabase,
}: {
  rows: ClaimRow[];
  supabase: SupabaseClient;
}) {
  const dropRowsById = new Map<string, DropRow>();
  const merchantIds = new Set<string>();
  const receiptRowsByClaimId = await loadReceiptsByClaimId(
    supabase,
    rows.map((row) => row.id),
  );

  await Promise.all(
    [...new Set(rows.map((row) => row.drop_id))].map(async (dropId) => {
      try {
        const dropRow = await loadCustomerDrop({ dropId, supabase });
        dropRowsById.set(dropId, dropRow);
        const merchantId = getDropMerchantId(dropRow);
        if (merchantId) merchantIds.add(merchantId);
      } catch (error) {
        if (!(error instanceof AppError && error.code === 'DROP_NOT_FOUND')) {
          throw error;
        }
      }
    }),
  );

  for (const row of rows) {
    const fallbackDrop = row.drops ? normalizeRelation(row.drops) : null;
    const merchantId = fallbackDrop ? getDropMerchantId(fallbackDrop) : null;
    if (merchantId) merchantIds.add(merchantId);
  }

  const categoriesByMerchant = await loadCategoriesByMerchantId(supabase, [...merchantIds]);
  const serverNow = new Date().toISOString();

  return rows.map((row) =>
    toClaimDto(row, {
      categoriesByMerchant,
      dropRow: dropRowsById.get(row.drop_id) ?? null,
      receiptRow: receiptRowsByClaimId.get(row.id) ?? null,
      serverNow,
    }),
  );
}

export async function loadCustomerDrop({
  dropId,
  supabase,
}: {
  dropId: string;
  supabase: SupabaseClient;
}) {
  const { data, error } = await supabase.rpc('get_customer_drop', {
    input_drop_id: dropId,
  });

  if (error) {
    if (error.code === 'PGRST202' || error.message.toLowerCase().includes('get_customer_drop')) {
      logSupabaseError('loadCustomerDrop.get_customer_drop.missing', error);
      throw new AppError(
        500,
        'INTERNAL_ERROR',
        'Customer drop detail RPC is not installed. Run the Batch 1 migration.',
      );
    }

    logSupabaseError('loadCustomerDrop.get_customer_drop', error);
    throw new AppError(500, 'INTERNAL_ERROR', 'Could not load drop.');
  }

  const row = firstRow<DropRow>(data);

  if (!row) {
    throw new AppError(404, 'DROP_NOT_FOUND', 'Drop not found.');
  }

  return row;
}

async function loadCategoriesByMerchantId(
  supabase: SupabaseClient,
  merchantIds: string[],
): Promise<Map<string, MerchantCategoryDto[]>> {
  const uniqueMerchantIds = [...new Set(merchantIds.filter(Boolean))];
  const categoriesByMerchant = new Map<string, MerchantCategoryDto[]>();

  if (uniqueMerchantIds.length === 0) {
    return categoriesByMerchant;
  }

  const { data, error } = await supabase
    .from('merchant_categories')
    .select('merchant_id, is_primary, sort_order, categories(id, name_en, name_ar, slug, is_active)')
    .in('merchant_id', uniqueMerchantIds)
    .order('is_primary', { ascending: false })
    .order('sort_order', { ascending: true });

  if (error) {
    logSupabaseError('loadCategoriesByMerchantId.selectCategories', error);
    throw new AppError(500, 'INTERNAL_ERROR', 'Could not load merchant categories.');
  }

  for (const row of (data ?? []) as MerchantCategoryRow[]) {
    const category = row.categories ? normalizeRelation(row.categories) : null;

    if (!category || category.is_active === false) {
      continue;
    }

    const mapped = {
      id: category.id,
      nameEn: category.name_en,
      nameAr: category.name_ar,
      slug: category.slug,
      isPrimary: row.is_primary === true,
    };
    const existing = categoriesByMerchant.get(row.merchant_id) ?? [];
    existing.push(mapped);
    categoriesByMerchant.set(row.merchant_id, existing);
  }

  return categoriesByMerchant;
}

function toClaimDto(
  row: ClaimRow,
  {
    categoriesByMerchant,
    dropRow,
    receiptRow,
    serverNow,
  }: {
    categoriesByMerchant: Map<string, MerchantCategoryDto[]>;
    dropRow: DropRow | null;
    receiptRow: ReceiptRow | null;
    serverNow: string;
  },
): ClaimDto {
  const fallbackDrop = row.drops ? normalizeRelation(row.drops) : null;
  const effectiveDrop = dropRow ?? fallbackDrop;
  const dropDto = effectiveDrop
    ? toDropDto(effectiveDrop, {
        categoriesByMerchant,
        detail: true,
        serverNow,
      })
    : null;
  const isExpired = row.status === 'expired' || isClaimReservationExpired(row.claim_expires_at);
  const receipt = receiptRow ?? firstRelation(row.claim_receipts);

  return {
    claimId: row.id,
    id: row.id,
    dropId: row.drop_id,
    status: row.status,
    claimCode: row.claim_code,
    claimedAt: row.claimed_at,
    claimExpiresAt: row.claim_expires_at,
    expiredAt: row.expired_at,
    validatedAt: row.validated_at,
    approvedAt: row.approved_at,
    paidAt: row.paid_at,
    rejectedReason: row.rejected_reason,
    amountSpent: nullableNumber(row.amount_spent),
    cashbackAmount: nullableNumber(row.cashback_amount),
    payoutPhone: row.payout_phone,
    validationMethod: effectiveDrop?.validation_method ?? null,
    isExpired,
    canClaimAgain: row.status === 'expired' || row.status === 'rejected' || isExpired,
    serverNow,
    drop: dropDto ? toClaimDropDto(dropDto) : null,
    merchant: dropDto?.merchant ?? null,
    receipt: receipt ? toReceiptDto(receipt) : null,
  };
}

async function loadReceiptsByClaimId(supabase: SupabaseClient, claimIds: string[]) {
  const uniqueClaimIds = [...new Set(claimIds.filter(Boolean))];
  const receiptsByClaimId = new Map<string, ReceiptRow>();

  if (uniqueClaimIds.length === 0) {
    return receiptsByClaimId;
  }

  const { data, error } = await supabase
    .from('claim_receipts')
    .select(CLAIM_RECEIPT_SELECT)
    .in('claim_id', uniqueClaimIds);

  if (error) {
    logSupabaseError('loadReceiptsByClaimId.selectReceipts', error);
    throw new AppError(500, 'INTERNAL_ERROR', 'Could not load claim receipts.');
  }

  for (const receipt of (data ?? []) as ReceiptRow[]) {
    if (receipt.claim_id) {
      receiptsByClaimId.set(receipt.claim_id, receipt);
    }
  }

  return receiptsByClaimId;
}

function toClaimDropDto(drop: DropDto): ClaimDropDto {
  return {
    id: drop.id,
    title: drop.title,
    description: drop.description,
    cashbackAmount: drop.cashbackAmount,
    minimumSpend: drop.minimumSpend,
    validationMethod: drop.validationMethod,
    startDate: drop.startDate,
    endDate: drop.endDate,
    maxClaims: drop.maxClaims,
    remainingCapacity: drop.remainingCapacity,
  };
}

function toReceiptDto(row: ReceiptRow): ClaimReceiptDto {
  return {
    receiptId: row.id,
    amountSpent: nullableNumber(row.amount_spent),
    submittedAt: row.created_at,
    reviewedAt: row.reviewed_at,
    rejectionReason: row.rejection_reason,
  };
}

export async function hydrateCustomerDropDtos({
  rows,
  supabase,
  serverNow,
  detail = true,
}: {
  rows: DropRow[];
  supabase: SupabaseClient;
  serverNow: string;
  detail?: boolean;
}) {
  const categoriesByMerchant = await loadCategoriesByMerchantId(
    supabase,
    merchantIdsFromDropRows(rows),
  );

  return rows.map((row) =>
    toDropDto(row, {
      categoriesByMerchant,
      detail,
      serverNow,
    }),
  );
}

function toDropDto(
  row: DropRow,
  {
    categoriesByMerchant,
    detail,
    serverNow,
  }: {
    categoriesByMerchant: Map<string, MerchantCategoryDto[]>;
    detail: boolean;
    serverNow: string;
  },
): DropDto {
  const merchantId = getDropMerchantId(row);
  const availability = getAvailability(row, serverNow);
  const merchant = getDropMerchant(row, categoriesByMerchant);
  const drop: DropDto = {
    id: row.id,
    title: row.title,
    description: row.description,
    cashbackAmount: Number(row.cashback_amount),
    minimumSpend: Number(row.minimum_spend),
    validationMethod: row.validation_method,
    startDate: row.start_date,
    endDate: row.end_date,
    maxClaims: nullableInteger(row.max_claims),
    claimCount: nullableInteger(row.claim_count) ?? 0,
    remainingCapacity: nullableInteger(row.remaining_capacity),
    isAvailable: availability.isAvailable,
    availabilityStatus: availability.status,
    merchant,
    viewer: {
      canClaim: availability.status === 'available',
      hasActiveMerchantClaim: row.has_active_merchant_claim === true,
      alreadyRedeemedMerchant: row.already_redeemed_merchant === true,
      currentClaimId: row.current_claim_id ?? null,
    },
  };

  if (detail) {
    drop.availabilityReason = availability.status === 'available' ? undefined : availability.status;
    drop.claimValidityHours = nullableInteger(row.claim_validity_hours);
  }

  if (merchant && merchant.merchantId === null && merchantId) {
    merchant.merchantId = merchantId;
  }

  return drop;
}

function getAvailability(
  row: DropRow,
  serverNow: string,
): { status: AvailabilityStatus; isAvailable: boolean } {
  const now = new Date(serverNow);
  const startDate = row.start_date ? new Date(row.start_date) : null;
  const endDate = row.end_date ? new Date(row.end_date) : null;
  const remaining = nullableInteger(row.remaining_capacity);
  const dropActive = row.is_active !== false;
  const merchantActive =
    row.merchant_is_active !== false &&
    getMerchantRelationshipStatus(row) !== 'inactive' &&
    row.merchant_relationship_status !== 'inactive';

  if (!dropActive) return { status: 'inactive', isAvailable: false };
  if (startDate && startDate > now) return { status: 'upcoming', isAvailable: false };
  if (endDate && endDate < now) return { status: 'ended', isAvailable: false };
  if (!merchantActive) return { status: 'merchant_inactive', isAvailable: false };

  const factualAvailable = remaining === null || remaining > 0;
  if (!factualAvailable) return { status: 'full', isAvailable: false };
  if (row.has_active_merchant_claim === true) {
    return { status: 'merchant_claim_active', isAvailable: true };
  }
  if (row.already_redeemed_merchant === true) {
    return { status: 'merchant_already_redeemed', isAvailable: true };
  }

  return { status: 'available', isAvailable: true };
}

function getDropMerchant(
  row: DropRow,
  categoriesByMerchant = new Map<string, MerchantCategoryDto[]>(),
): MerchantDto | null {
  const relationMerchant = row.merchants ? normalizeRelation(row.merchants) : null;

  if (relationMerchant) {
    const merchantId = relationMerchant.id ?? row.merchant_id ?? null;
    return {
      merchantId,
      name: relationMerchant.name,
      branch: relationMerchant.branch,
      area: relationMerchant.area,
      imageUrl: relationMerchant.merchant_image_url ?? null,
      categories: merchantId ? categoriesByMerchant.get(merchantId) ?? [] : [],
    };
  }

  if (
    row.merchant_id === undefined &&
    row.merchant_name === undefined &&
    row.merchant_branch === undefined &&
    row.merchant_area === undefined &&
    row.merchant_image_url === undefined
  ) {
    return null;
  }

  const merchantId = row.merchant_id ?? null;
  return {
    merchantId,
    name: row.merchant_name ?? null,
    branch: row.merchant_branch ?? null,
    area: row.merchant_area ?? null,
    imageUrl: row.merchant_image_url ?? null,
    categories: merchantId ? categoriesByMerchant.get(merchantId) ?? [] : [],
  };
}

function getDropMerchantId(row: DropRow): string | null {
  if (row.merchant_id) return row.merchant_id;
  const relationMerchant = row.merchants ? normalizeRelation(row.merchants) : null;
  return relationMerchant?.id ?? null;
}

function getMerchantRelationshipStatus(row: DropRow): string | null {
  if (row.merchant_relationship_status) return row.merchant_relationship_status;
  const relationMerchant = row.merchants ? normalizeRelation(row.merchants) : null;
  return relationMerchant?.relationship_status ?? null;
}

function merchantIdsFromDropRows(rows: DropRow[]) {
  return rows.map(getDropMerchantId).filter((merchantId): merchantId is string => Boolean(merchantId));
}

function normalizeRelation<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value;
}

function firstRelation<T>(value?: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function nullableNumber(value: number | string | null | undefined) {
  return value === null || value === undefined ? null : Number(value);
}

function nullableInteger(value: number | string | null | undefined) {
  const number = nullableNumber(value);
  return number === null || Number.isNaN(number) ? null : Math.trunc(number);
}

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) {
    return (data[0] as T | undefined) ?? null;
  }

  return (data as T | null) ?? null;
}

function logSupabaseError(operation: string, error: PostgrestError) {
  console.error('Unexpected Supabase error', {
    operation,
    code: error.code,
    message: error.message,
    details: error.details || undefined,
    hint: error.hint || undefined,
  });
}

function isClaimReservationExpired(claimExpiresAt: string | null, now = new Date()) {
  if (!claimExpiresAt) return false;
  const expiresAt = new Date(claimExpiresAt);
  return !Number.isNaN(expiresAt.getTime()) && expiresAt <= now;
}

function isClaimActive(status: string, claimExpiresAt: string | null, now = new Date()) {
  if (status !== 'claimed') {
    return ACTIVE_CLAIM_STATUSES.includes(status as (typeof ACTIVE_CLAIM_STATUSES)[number]);
  }

  if (!claimExpiresAt) {
    return true;
  }

  const expiresAt = new Date(claimExpiresAt);

  if (Number.isNaN(expiresAt.getTime())) {
    return true;
  }

  return expiresAt > now;
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && value === parsed.toISOString().slice(0, 10);
}

function toClaimDropAppError(error: PostgrestError) {
  const message = error.message.toLowerCase();

  if (error.code === '42501' || message.includes('authentication')) {
    return new AppError(401, 'AUTH_REQUIRED', 'Authentication required.');
  }

  if (error.code === 'P0002' || message.includes('not found')) {
    return new AppError(404, 'DROP_NOT_FOUND', 'Drop not found.');
  }

  if (message.includes('merchant_already_redeemed')) {
    return new AppError(
      409,
      'MERCHANT_ALREADY_REDEEMED',
      "You've already tried this place through Jareb. Discover another reward.",
    );
  }

  if (message.includes('merchant_claim_active')) {
    return new AppError(
      409,
      'MERCHANT_CLAIM_ACTIVE',
      'You already have a reward in progress for this place.',
    );
  }

  if (error.code === '23505' || message.includes('existing active claim')) {
    return new AppError(409, 'MERCHANT_CLAIM_ACTIVE', 'Active claim already exists.');
  }

  if (message.includes('fully claimed')) {
    return new AppError(409, 'DROP_FULL', 'Drop has been fully claimed.');
  }

  if (message.includes('no longer available') || message.includes('expired')) {
    return new AppError(410, 'DROP_UNAVAILABLE', 'Drop is no longer available.');
  }

  if (
    message.includes('currently unavailable') ||
    message.includes('not available yet') ||
    message.includes('unavailable')
  ) {
    return new AppError(409, 'DROP_UNAVAILABLE', 'Drop is currently unavailable.');
  }

  return new AppError(500, 'INTERNAL_ERROR', 'Could not create claim.');
}

function toPayoutPhoneAppError(error: PostgrestError) {
  const message = error.message.toLowerCase();

  if (message.includes('not found') || message.includes('not found for this account')) {
    return new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
  }

  if (error.code === '42501' || message.includes('authentication')) {
    return new AppError(401, 'AUTH_REQUIRED', 'Authentication required.');
  }

  if (error.code === '23514' || message.includes('valid bahrain benefitpay')) {
    return new AppError(400, 'INVALID_PHONE', 'A valid Bahrain BenefitPay number is required.');
  }

  if (error.code === '23505' || message.includes('already linked')) {
    return new AppError(
      409,
      'BENEFITPAY_IN_USE',
      'This BenefitPay number is already linked to another account.',
    );
  }

  if (message.includes('can only be saved') || message.includes('before visit confirmation')) {
    return new AppError(409, 'CLAIM_NOT_ACTIVE', 'Claim can no longer be updated.');
  }

  return new AppError(500, 'INTERNAL_ERROR', 'Could not save payout phone.');
}

export function toReceiptSubmissionAppError(error: PostgrestError) {
  const message = error.message.toLowerCase();

  if (message.includes('not found for this account') || message.includes('claim not found')) {
    return new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
  }

  if (error.code === '42501' || message.includes('authentication')) {
    return new AppError(401, 'AUTH_REQUIRED', 'Authentication required.');
  }

  if (error.code === 'P0002' && message.includes('upload')) {
    return new AppError(404, 'RECEIPT_UPLOAD_NOT_FOUND', 'Receipt upload was not found.');
  }

  if (error.code === 'P0002') {
    return new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
  }

  if (message.includes('claim_expired')) {
    return new AppError(410, 'CLAIM_EXPIRED', 'This claim reservation has expired.');
  }

  if (message.includes('can only be submitted') || message.includes('claimed reward')) {
    return new AppError(409, 'CLAIM_NOT_ACTIVE', 'Receipt can only be submitted for an active claim.');
  }

  if (message.includes('payout phone')) {
    return new AppError(
      409,
      'MISSING_PAYOUT_PHONE',
      'A payout phone is required before receipt submission.',
    );
  }

  if (message.includes('does not accept receipt upload')) {
    return new AppError(
      409,
      'WRONG_VALIDATION_METHOD',
      'This reward does not accept receipt upload.',
    );
  }

  if (message.includes('minimum spend')) {
    return new AppError(
      400,
      'AMOUNT_BELOW_MINIMUM',
      'The amount spent does not meet the minimum spend.',
    );
  }

  if (message.includes('purchase date')) {
    return new AppError(400, 'INVALID_RECEIPT', 'Purchase date is invalid for this reward.');
  }

  if (message.includes('unsupported receipt file type')) {
    return new AppError(400, 'RECEIPT_TYPE_INVALID', 'Receipt image type is not supported.');
  }

  if (message.includes('too large')) {
    return new AppError(413, 'RECEIPT_TOO_LARGE', 'Receipt image must be 5 MB or smaller.');
  }

  if (message.includes('invalid receipt storage path')) {
    return new AppError(400, 'INVALID_RECEIPT', 'Receipt storage path is invalid.');
  }

  if (error.code === '23505' || message.includes('already submitted')) {
    return new AppError(
      409,
      'RECEIPT_ALREADY_SUBMITTED',
      'A receipt has already been submitted for this claim.',
    );
  }

  if (message.includes('unavailable') || message.includes('no longer available')) {
    return new AppError(409, 'DROP_UNAVAILABLE', 'Drop is currently unavailable.');
  }

  return new AppError(500, 'INTERNAL_ERROR', 'Could not submit receipt.');
}

function toMerchantPinRpcAppError(error: PostgrestError) {
  const message = error.message.toLowerCase();

  if (error.code === '42501' || message.includes('authentication')) {
    return new AppError(401, 'AUTH_REQUIRED', 'Authentication required.');
  }

  return new AppError(500, 'INTERNAL_ERROR', 'Could not verify merchant PIN.');
}

function toMerchantPinValidationAppError(errorCode: string | null) {
  if (errorCode === 'wrong_pin') {
    return new AppError(400, 'INVALID_PIN', 'The merchant PIN is incorrect.');
  }

  if (errorCode === 'too_many_pin_attempts') {
    return new AppError(429, 'PIN_LOCKED', 'Too many incorrect PIN attempts. Try again later.');
  }

  if (errorCode === 'minimum_spend_not_met') {
    return new AppError(
      400,
      'MINIMUM_SPEND_NOT_MET',
      'The amount spent does not meet the minimum spend.',
    );
  }

  if (errorCode === 'claim_expired') {
    return new AppError(410, 'CLAIM_EXPIRED', 'This claim reservation has expired.');
  }

  if (errorCode === 'claim_already_validated') {
    return new AppError(409, 'CLAIM_NOT_ACTIVE', 'This claim has already been verified.');
  }

  if (errorCode === 'claim_not_found' || errorCode === 'claim_not_owned') {
    return new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
  }

  if (errorCode === 'missing_payout_phone') {
    return new AppError(
      409,
      'MISSING_PAYOUT_PHONE',
      'A payout phone is required before verification.',
    );
  }

  if (errorCode === 'invalid_amount') {
    return new AppError(400, 'BAD_REQUEST', 'A valid spendAmount value is required.');
  }

  if (errorCode === 'wrong_validation_method') {
    return new AppError(409, 'CLAIM_NOT_ACTIVE', 'This claim does not use merchant PIN.');
  }

  if (errorCode === 'reward_expired') {
    return new AppError(410, 'DROP_UNAVAILABLE', 'Drop is no longer available.');
  }

  if (errorCode === 'reward_unavailable') {
    return new AppError(409, 'DROP_UNAVAILABLE', 'Drop is currently unavailable.');
  }

  return new AppError(409, 'CLAIM_NOT_ACTIVE', 'Claim could not be verified.');
}

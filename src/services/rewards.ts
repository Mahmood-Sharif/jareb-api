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
  'paid',
] as const;

type MerchantRow = {
  name: string | null;
  branch: string | null;
  area: string | null;
  merchant_image_url?: string | null;
};

type DropRow = {
  id: string;
  title: string;
  description: string | null;
  cashback_amount: number | string;
  minimum_spend: number | string;
  validation_method: string | null;
  start_date: string | null;
  end_date: string | null;
  merchants?: MerchantRow | MerchantRow[] | null;
};

type ClaimRow = {
  id: string;
  drop_id: string;
  status: string;
  claim_code: string | null;
  cashback_amount: number | string | null;
  amount_spent: number | string | null;
  payout_phone: string | null;
  rejected_reason: string | null;
  claim_expires_at: string | null;
  expired_at: string | null;
  drops?: DropRow | DropRow[] | null;
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

export type MerchantDto = {
  name: string | null;
  branch: string | null;
  area: string | null;
  imageUrl: string | null;
};

export type DropDto = {
  id: string;
  title: string;
  description: string | null;
  cashbackAmount: number;
  minimumSpend: number;
  validationMethod: string | null;
  startDate: string | null;
  endDate: string | null;
  merchant: MerchantDto | null;
};

export type ClaimDto = {
  id: string;
  dropId: string;
  status: string;
  claimCode: string | null;
  cashbackAmount: number | null;
  amountSpent: number | null;
  payoutPhone: string | null;
  rejectedReason: string | null;
  claimExpiresAt: string | null;
  expiredAt: string | null;
  drop: DropDto | null;
};

export type RewardsServiceContext = {
  accessToken: string;
  bindings: Bindings;
  userId: string;
};

export type RewardsService = {
  listDrops(context: RewardsServiceContext): Promise<DropDto[]>;
  getDrop(context: RewardsServiceContext & { dropId: string }): Promise<DropDto>;
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
};

const DROP_SELECT =
  'id, title, description, cashback_amount, minimum_spend, validation_method, start_date, end_date, merchants!inner(name, branch, area, merchant_image_url, is_active)';

const CLAIM_SELECT =
  'id, drop_id, status, claim_code, cashback_amount, amount_spent, payout_phone, rejected_reason, claim_expires_at, expired_at, drops(id, title, description, cashback_amount, minimum_spend, validation_method, start_date, end_date, merchants(name, branch, area, merchant_image_url))';

function createClient({ accessToken, bindings }: RewardsServiceContext) {
  return createSupabaseUserClient({
    ...getSupabaseAuthConfig(bindings),
    accessToken,
  });
}

export const rewardsService: RewardsService = {
  async listDrops(context) {
    const supabase = createClient(context);
    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from('drops')
      .select(DROP_SELECT)
      .eq('is_active', true)
      .lte('start_date', nowIso)
      .gte('end_date', nowIso)
      .eq('merchants.is_active', true)
      .order('created_at', { ascending: true });

    if (error) {
      throw new AppError(500, 'INTERNAL_SERVER_ERROR', 'Could not load drops.');
    }

    return ((data ?? []) as DropRow[]).map(toDropDto);
  },

  async getDrop(context) {
    const supabase = createClient(context);
    const { data, error } = await supabase
      .from('drops')
      .select(DROP_SELECT)
      .eq('id', context.dropId)
      .maybeSingle();

    if (error) {
      throw new AppError(500, 'INTERNAL_SERVER_ERROR', 'Could not load drop.');
    }

    if (!data) {
      throw new AppError(404, 'DROP_NOT_FOUND', 'Drop not found.');
    }

    return toDropDto(data as DropRow);
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
      throw new AppError(500, 'INTERNAL_SERVER_ERROR', 'Could not create claim.');
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
      .order('created_at', { ascending: false });

    if (error) {
      throw new AppError(500, 'INTERNAL_SERVER_ERROR', 'Could not load claims.');
    }

    return ((data ?? []) as ClaimRow[]).map(toClaimDto);
  },

  async listActiveClaims(context) {
    const supabase = createClient(context);
    const { data, error } = await supabase
      .from('claims')
      .select(CLAIM_SELECT)
      .eq('user_id', context.userId)
      .in('status', [...ACTIVE_CLAIM_STATUSES])
      .order('created_at', { ascending: false });

    if (error) {
      throw new AppError(500, 'INTERNAL_SERVER_ERROR', 'Could not load active claims.');
    }

    return ((data ?? []) as ClaimRow[])
      .filter((claim) => isClaimActive(claim.status, claim.claim_expires_at))
      .map(toClaimDto);
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
      throw new AppError(500, 'INTERNAL_SERVER_ERROR', 'Could not save payout phone.');
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
      throw new AppError(500, 'INTERNAL_SERVER_ERROR', 'Could not verify merchant PIN.');
    }

    if (!result.validation_succeeded) {
      throw toMerchantPinValidationAppError(result.error_code);
    }

    if (!result.claim_id) {
      throw new AppError(500, 'INTERNAL_SERVER_ERROR', 'Could not verify merchant PIN.');
    }

    return loadOwnedClaim({
      claimId: result.claim_id,
      supabase,
      userId: context.userId,
    });
  },
};

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
    throw new AppError(500, 'INTERNAL_SERVER_ERROR', 'Could not load claim.');
  }

  if (!data) {
    throw new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
  }

  return toClaimDto(data as ClaimRow);
}

function toClaimDto(row: ClaimRow): ClaimDto {
  return {
    id: row.id,
    dropId: row.drop_id,
    status: row.status,
    claimCode: row.claim_code,
    cashbackAmount: nullableNumber(row.cashback_amount),
    amountSpent: nullableNumber(row.amount_spent),
    payoutPhone: row.payout_phone,
    rejectedReason: row.rejected_reason,
    claimExpiresAt: row.claim_expires_at,
    expiredAt: row.expired_at,
    drop: row.drops ? toDropDto(normalizeRelation(row.drops)) : null,
  };
}

function toDropDto(row: DropRow): DropDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    cashbackAmount: Number(row.cashback_amount),
    minimumSpend: Number(row.minimum_spend),
    validationMethod: row.validation_method,
    startDate: row.start_date,
    endDate: row.end_date,
    merchant: row.merchants ? toMerchantDto(normalizeRelation(row.merchants)) : null,
  };
}

function toMerchantDto(row: MerchantRow): MerchantDto {
  return {
    name: row.name,
    branch: row.branch,
    area: row.area,
    imageUrl: row.merchant_image_url ?? null,
  };
}

function normalizeRelation<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value;
}

function nullableNumber(value: number | string | null) {
  return value === null ? null : Number(value);
}

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) {
    return (data[0] as T | undefined) ?? null;
  }

  return (data as T | null) ?? null;
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

function toClaimDropAppError(error: PostgrestError) {
  const message = error.message.toLowerCase();

  if (error.code === '42501' || message.includes('authentication')) {
    return new AppError(401, 'UNAUTHORIZED', 'Authentication required.');
  }

  if (error.code === 'P0002' || message.includes('not found')) {
    return new AppError(404, 'DROP_NOT_FOUND', 'Drop not found.');
  }

  if (error.code === '23505' || message.includes('existing active claim')) {
    return new AppError(409, 'ALREADY_CLAIMED', 'Active claim already exists.');
  }

  if (message.includes('fully claimed')) {
    return new AppError(409, 'DROP_FULL', 'Drop has been fully claimed.');
  }

  if (message.includes('no longer available') || message.includes('expired')) {
    return new AppError(410, 'DROP_EXPIRED', 'Drop is no longer available.');
  }

  if (
    message.includes('currently unavailable') ||
    message.includes('not available yet') ||
    message.includes('unavailable')
  ) {
    return new AppError(409, 'DROP_INACTIVE', 'Drop is currently unavailable.');
  }

  return new AppError(500, 'INTERNAL_SERVER_ERROR', 'Could not create claim.');
}

function toPayoutPhoneAppError(error: PostgrestError) {
  const message = error.message.toLowerCase();

  if (message.includes('not found') || message.includes('not found for this account')) {
    return new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
  }

  if (error.code === '42501' || message.includes('authentication')) {
    return new AppError(401, 'UNAUTHORIZED', 'Authentication required.');
  }

  if (error.code === '23514' || message.includes('valid bahrain benefitpay')) {
    return new AppError(
      400,
      'INVALID_PAYOUT_PHONE',
      'A valid Bahrain BenefitPay number is required.',
    );
  }

  if (error.code === '23505' || message.includes('already linked')) {
    return new AppError(
      409,
      'PAYOUT_PHONE_IN_USE',
      'This BenefitPay number is already linked to another account.',
    );
  }

  if (message.includes('can only be saved') || message.includes('before visit confirmation')) {
    return new AppError(409, 'CLAIM_NOT_ACTIVE', 'Claim can no longer be updated.');
  }

  return new AppError(500, 'INTERNAL_SERVER_ERROR', 'Could not save payout phone.');
}

function toMerchantPinRpcAppError(error: PostgrestError) {
  const message = error.message.toLowerCase();

  if (error.code === '42501' || message.includes('authentication')) {
    return new AppError(401, 'UNAUTHORIZED', 'Authentication required.');
  }

  return new AppError(500, 'INTERNAL_SERVER_ERROR', 'Could not verify merchant PIN.');
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
    return new AppError(409, 'CLAIM_ALREADY_VERIFIED', 'This claim has already been verified.');
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
    return new AppError(409, 'INVALID_CLAIM_STATE', 'This claim does not use merchant PIN.');
  }

  if (errorCode === 'reward_expired') {
    return new AppError(410, 'DROP_EXPIRED', 'Drop is no longer available.');
  }

  if (errorCode === 'reward_unavailable') {
    return new AppError(409, 'DROP_INACTIVE', 'Drop is currently unavailable.');
  }

  return new AppError(409, 'INVALID_CLAIM_STATE', 'Claim could not be verified.');
}

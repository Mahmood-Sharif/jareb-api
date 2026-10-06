import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseAuthConfig } from '../config/env';
import { AppError } from '../errors/app-error';
import { createSupabaseUserClient } from './supabase';
import type { Bindings } from '../types/app';

type WalletClaimStatus = 'approved' | 'paid';

type WalletClaimRow = {
  id: string;
  status: string;
  cashback_amount: number | string | null;
  approved_at: string | null;
  paid_at: string | null;
  drops?: {
    merchants?: {
      name: string | null;
    } | { name: string | null }[] | null;
  } | {
    merchants?: {
      name: string | null;
    } | { name: string | null }[] | null;
  }[] | null;
};

type WalletProfileRow = {
  benefitpay_number: string | null;
};

export type WalletActivityDto = {
  claimId: string;
  merchantName: string | null;
  amount: number;
  status: WalletClaimStatus;
  eventDate: string;
};

export type PayoutMethodDto = {
  type: 'benefitpay';
  phone: string | null;
  maskedPhone: string | null;
};

export type WalletDto = {
  cashbackEarned: number;
  onTheWay: number;
  successfulDropCount: number;
  payoutMethod: PayoutMethodDto;
  activity: WalletActivityDto[];
};

export type WalletResponseDto = {
  serverNow: string;
  wallet: WalletDto;
};

export type WalletServiceContext = {
  accessToken: string;
  bindings: Bindings;
  userId: string;
};

export type WalletService = {
  getWallet(context: WalletServiceContext): Promise<WalletResponseDto>;
};

function createClient({ accessToken, bindings }: WalletServiceContext) {
  return createSupabaseUserClient({
    ...getSupabaseAuthConfig(bindings),
    accessToken,
  });
}

export const walletService: WalletService = {
  async getWallet(context) {
    const supabase = createClient(context);
    const serverNow = new Date().toISOString();
    const [claims, profile] = await Promise.all([
      loadWalletClaims({ supabase, userId: context.userId }),
      loadWalletProfile({ supabase, userId: context.userId }),
    ]);

    return {
      serverNow,
      wallet: buildWallet({
        claims,
        payoutPhone: profile?.benefitpay_number ?? null,
      }),
    };
  },
};

async function loadWalletClaims({
  supabase,
  userId,
}: {
  supabase: SupabaseClient;
  userId: string;
}) {
  const { data, error } = await supabase
    .from('claims')
    .select('id, status, cashback_amount, approved_at, paid_at, drops(merchants(name))')
    .eq('user_id', userId)
    .in('status', ['approved', 'paid']);

  if (error) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Could not load wallet.');
  }

  return (data ?? []) as WalletClaimRow[];
}

async function loadWalletProfile({
  supabase,
  userId,
}: {
  supabase: SupabaseClient;
  userId: string;
}) {
  const { data, error } = await supabase
    .from('profiles')
    .select('benefitpay_number')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Could not load wallet.');
  }

  return data as WalletProfileRow | null;
}

export function buildWallet({
  claims,
  payoutPhone,
}: {
  claims: WalletClaimRow[];
  payoutPhone: string | null;
}): WalletDto {
  const activity = claims
    .map(toWalletActivity)
    .sort((left, right) => right.eventDate.localeCompare(left.eventDate));

  return {
    cashbackEarned: roundMoney(
      activity
        .filter((item) => item.status === 'paid')
        .reduce((sum, item) => sum + item.amount, 0),
    ),
    onTheWay: roundMoney(
      activity
        .filter((item) => item.status === 'approved')
        .reduce((sum, item) => sum + item.amount, 0),
    ),
    successfulDropCount: activity.length,
    payoutMethod: {
      type: 'benefitpay',
      phone: payoutPhone,
      maskedPhone: maskBenefitPayPhone(payoutPhone),
    },
    activity,
  };
}

function toWalletActivity(row: WalletClaimRow): WalletActivityDto {
  const status = toWalletStatus(row.status);
  const eventDate = status === 'paid' ? row.paid_at : row.approved_at;

  if (!eventDate) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Wallet claim is missing its event date.');
  }

  return {
    claimId: row.id,
    merchantName: walletMerchantName(row),
    amount: roundMoney(numberValue(row.cashback_amount)),
    status,
    eventDate,
  };
}

function toWalletStatus(status: string): WalletClaimStatus {
  if (status === 'approved' || status === 'paid') {
    return status;
  }

  throw new AppError(500, 'INTERNAL_ERROR', 'Wallet claim has an unsupported status.');
}

function walletMerchantName(row: WalletClaimRow) {
  const drop = firstRelation(row.drops);
  const merchant = firstRelation(drop?.merchants);
  return merchant?.name ?? null;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function numberValue(value: number | string | null) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export function maskBenefitPayPhone(phone: string | null) {
  if (!phone) return null;

  const digits = phone.replace(/\D/g, '');
  if (digits.length >= 8) {
    return `+973 **** ${digits.slice(-4)}`;
  }

  return `**** ${phone.slice(-4)}`;
}

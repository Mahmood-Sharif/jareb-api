import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getAccountIdentityHmacSecret,
  getSupabaseServiceConfig,
} from '../config/env';
import { AppError } from '../errors/app-error';
import { createSupabaseServiceClient } from './supabase';
import type { Bindings } from '../types/app';

type ProfileRow = {
  phone: string | null;
  benefitpay_number: string | null;
};

type DeleteAccountResult = {
  deleted_account_id: string;
  payout_retention_required: boolean;
};

export type DeleteAccountContext = {
  bindings: Bindings;
  userId: string;
};

export type AccountDeletionService = {
  deleteAccount(context: DeleteAccountContext): Promise<{ deleted: true }>;
};

export const accountDeletionService: AccountDeletionService = {
  async deleteAccount(context) {
    const supabase = createSupabaseServiceClient(getSupabaseServiceConfig(context.bindings));
    const fingerprint = await loadIdentityFingerprint({
      bindings: context.bindings,
      supabase,
      userId: context.userId,
    });

    const { error } = await supabase.rpc('delete_account_for_user', {
      input_user_id: context.userId,
      input_identity_fingerprint: fingerprint,
    });

    if (error) {
      logAccountDeletionError('deleteAccount.delete_account_for_user', error);
      throw new AppError(500, 'ACCOUNT_DELETE_FAILED', 'Could not delete account.');
    }

    const { error: authError } = await supabase.auth.admin.deleteUser(context.userId);

    if (authError) {
      logAccountDeletionError('deleteAccount.auth.deleteUser', authError);
      throw new AppError(500, 'ACCOUNT_DELETE_FAILED', 'Could not delete account.');
    }

    return { deleted: true };
  },
};

async function loadIdentityFingerprint({
  bindings,
  supabase,
  userId,
}: {
  bindings: Bindings;
  supabase: SupabaseClient;
  userId: string;
}) {
  const { data, error } = await supabase
    .from('profiles')
    .select('phone, benefitpay_number')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    logAccountDeletionError('deleteAccount.loadProfile', error);
    throw new AppError(500, 'ACCOUNT_DELETE_FAILED', 'Could not delete account.');
  }

  const profile = data as ProfileRow | null;
  const identityValue = profile?.benefitpay_number ?? profile?.phone;
  if (!identityValue) {
    return null;
  }

  return hmacSha256Hex(getAccountIdentityHmacSecret(bindings), identityValue);
}

async function hmacSha256Hex(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function logAccountDeletionError(operation: string, error: unknown) {
  const supabaseError = error as {
    code?: string;
    details?: string;
    hint?: string;
    message?: string;
  };
  console.error('Account deletion error', {
    operation,
    code: supabaseError.code,
    message: supabaseError.message,
    details: supabaseError.details,
    hint: supabaseError.hint,
  });
}

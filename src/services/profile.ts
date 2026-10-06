import { getSupabaseAuthConfig } from '../config/env';
import { AppError } from '../errors/app-error';
import { createSupabaseUserClient } from './supabase';
import type { Bindings } from '../types/app';
import type { PostgrestError } from '@supabase/supabase-js';

export type JarebProfile = {
  fullName: string | null;
  phone: string | null;
  benefitpayNumber: string | null;
  termsAcceptedAt: string | null;
  termsVersion: string | null;
  privacyVersion: string | null;
};

type ProfileRow = {
  full_name: string | null;
  phone: string | null;
  benefitpay_number: string | null;
  terms_accepted_at: string | null;
  terms_version: string | null;
  privacy_version: string | null;
};

type UpdateProfileResult = {
  full_name: string | null;
  phone: string | null;
  benefitpay_number: string | null;
  terms_accepted_at?: string | null;
  terms_version?: string | null;
  privacy_version?: string | null;
};

export async function loadCurrentUserProfile({
  accessToken,
  bindings,
  userId,
}: {
  accessToken: string;
  bindings: Bindings;
  userId: string;
}): Promise<JarebProfile | null> {
  const supabaseConfig = getSupabaseAuthConfig(bindings);
  const supabase = createSupabaseUserClient({
    ...supabaseConfig,
    accessToken,
  });

  const { data, error } = await supabase
    .from('profiles')
    .select('full_name, phone, benefitpay_number, terms_accepted_at, terms_version, privacy_version')
    .eq('id', userId)
    .maybeSingle<ProfileRow>();

  if (error) {
    throw new AppError(500, 'INTERNAL_SERVER_ERROR', 'Could not load profile.');
  }

  if (!data) {
    return null;
  }

  return {
    fullName: data.full_name,
    phone: data.phone,
    benefitpayNumber: data.benefitpay_number,
    termsAcceptedAt: data.terms_accepted_at,
    termsVersion: data.terms_version,
    privacyVersion: data.privacy_version,
  };
}

export async function updateCurrentUserProfile({
  accessToken,
  benefitpayNumber,
  bindings,
  fullName,
  phone,
  privacyVersion,
  termsVersion,
}: {
  accessToken: string;
  bindings: Bindings;
  fullName: string;
  phone?: string | null;
  benefitpayNumber?: string | null;
  privacyVersion?: string | null;
  termsVersion?: string | null;
}): Promise<JarebProfile> {
  const supabaseConfig = getSupabaseAuthConfig(bindings);
  const supabase = createSupabaseUserClient({
    ...supabaseConfig,
    accessToken,
  });

  const { data, error } = await supabase.rpc('update_my_profile', {
    input_full_name: fullName,
    input_phone: phone ?? null,
    input_benefitpay_number: benefitpayNumber ?? null,
    input_terms_version: termsVersion ?? null,
    input_privacy_version: privacyVersion ?? null,
  });

  if (error) {
    throw toUpdateProfileAppError(error);
  }

  const result = Array.isArray(data)
    ? (data[0] as UpdateProfileResult | undefined)
    : (data as UpdateProfileResult | null);

  if (!result) {
    throw new AppError(500, 'INTERNAL_SERVER_ERROR', 'Could not update profile.');
  }

  return {
    fullName: result.full_name,
    phone: result.phone,
    benefitpayNumber: result.benefitpay_number,
    termsAcceptedAt: result.terms_accepted_at ?? null,
    termsVersion: result.terms_version ?? null,
    privacyVersion: result.privacy_version ?? null,
  };
}

function toUpdateProfileAppError(error: PostgrestError) {
  const message = error.message.toLowerCase();

  if (error.code === '42501' || message.includes('authentication required')) {
    return new AppError(401, 'UNAUTHORIZED', 'Authentication required.');
  }

  if (error.code === 'P0002' || message.includes('profile not found')) {
    return new AppError(404, 'PROFILE_NOT_FOUND', 'Profile not found.');
  }

  if (error.code === '23505' && message.includes('benefitpay')) {
    return new AppError(
      409,
      'PAYOUT_PHONE_IN_USE',
      'This BenefitPay number is already linked to another account.',
    );
  }

  if (error.code === '23505' && message.includes('phone')) {
    return new AppError(409, 'PHONE_IN_USE', 'This phone number is already registered.');
  }

  if (message.includes('benefitpay')) {
    return new AppError(400, 'INVALID_PAYOUT_PHONE', 'Enter a valid Bahrain BenefitPay number.');
  }

  if (message.includes('terms') || message.includes('privacy')) {
    return new AppError(400, 'BAD_REQUEST', 'Terms and Privacy acceptance is required.');
  }

  if (message.includes('phone')) {
    return new AppError(400, 'INVALID_PHONE', 'Enter a valid Bahrain phone number.');
  }

  if (message.includes('full name')) {
    return new AppError(400, 'BAD_REQUEST', 'Full name is required.');
  }

  return new AppError(500, 'INTERNAL_SERVER_ERROR', 'Could not update profile.');
}

import { getSupabaseAuthConfig } from '../config/env';
import { AppError } from '../errors/app-error';
import { createSupabaseUserClient } from './supabase';
import type { Bindings } from '../types/app';

export type JarebProfile = {
  fullName: string | null;
  phone: string | null;
  benefitpayNumber: string | null;
};

type ProfileRow = {
  full_name: string | null;
  phone: string | null;
  benefitpay_number: string | null;
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
    .select('full_name, phone, benefitpay_number')
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
  };
}

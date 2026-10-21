import { getSupabaseServiceConfig } from '../config/env';
import { AppError } from '../errors/app-error';
import type { Bindings } from '../types/app';
import { normalizeBahrainPhone, tryNormalizeBahrainPhone } from './bahrain-phone';
import { createSupabaseServiceClient } from './supabase';

const PROFILE_PAGE_SIZE = 1000;

export type PhoneAccountExists = (input: {
  bindings: Partial<Bindings>;
  phone: string;
}) => Promise<boolean>;

export const phoneAccountExists: PhoneAccountExists = async ({ bindings, phone }) => {
  let canonicalPhone: string;
  try {
    canonicalPhone = normalizeBahrainPhone(phone);
  } catch {
    throw new AppError(400, 'INVALID_PHONE', 'Enter a valid Bahrain phone number.');
  }

  const { serviceRoleKey, supabaseUrl } = getSupabaseServiceConfig(bindings);
  const supabase = createSupabaseServiceClient({ serviceRoleKey, supabaseUrl });

  for (let page = 0; ; page += 1) {
    const start = page * PROFILE_PAGE_SIZE;
    const { data, error } = await supabase
      .from('profiles')
      .select('phone')
      .not('phone', 'is', null)
      .range(start, start + PROFILE_PAGE_SIZE - 1);

    if (error) {
      console.error('phone signup eligibility profile lookup failed', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });

      throw new AppError(
        500,
        'INTERNAL_ERROR',
        'Could not verify phone signup eligibility.',
      );
    }

    const rows = data ?? [];
    if (rows.some((row) => tryNormalizeBahrainPhone(row.phone) === canonicalPhone)) {
      return true;
    }
    if (rows.length < PROFILE_PAGE_SIZE) return false;
  }
};

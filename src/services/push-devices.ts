import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseServiceConfig } from '../config/env';
import { AppError } from '../errors/app-error';
import type { Bindings } from '../types/app';
import { createSupabaseServiceClient } from './supabase';

export type PushPlatform = 'android' | 'ios' | 'web';

export type PushDeviceContext = {
  bindings: Bindings;
  userId: string;
};

export type PushDeviceService = {
  registerDevice(
    context: PushDeviceContext & {
      token: string;
      platform: PushPlatform;
      notificationsEnabled: boolean;
    },
  ): Promise<{ registered: true }>;
  unregisterDevice(
    context: PushDeviceContext & { token: string },
  ): Promise<{ unregistered: true }>;
};

function createClient(bindings: Bindings) {
  return createSupabaseServiceClient(getSupabaseServiceConfig(bindings));
}

export const pushDeviceService: PushDeviceService = {
  async registerDevice(context) {
    const now = new Date().toISOString();
    const { error } = await createClient(context.bindings)
      .from('push_devices')
      .upsert(
        {
          user_id: context.userId,
          fcm_token: context.token,
          platform: context.platform,
          notifications_enabled: context.notificationsEnabled,
          last_seen_at: now,
          updated_at: now,
        },
        { onConflict: 'fcm_token' },
      );

    if (error) {
      console.error('Push device registration failed', { code: error.code });
      throw new AppError(
        500,
        'PUSH_DEVICE_REGISTRATION_FAILED',
        'Could not register this device for notifications.',
      );
    }

    return { registered: true };
  },

  async unregisterDevice(context) {
    const { error } = await createClient(context.bindings)
      .from('push_devices')
      .delete()
      .eq('user_id', context.userId)
      .eq('fcm_token', context.token);

    if (error) {
      console.error('Push device removal failed', { code: error.code });
      throw new AppError(
        500,
        'PUSH_DEVICE_UNREGISTER_FAILED',
        'Could not unregister this device.',
      );
    }

    return { unregistered: true };
  },
};

export async function loadActivePushDevices({
  supabase,
  userId,
}: {
  supabase: SupabaseClient;
  userId?: string;
}) {
  type DeviceRow = {
    id: string;
    user_id: string;
    fcm_token: string;
    platform: PushPlatform;
  };
  const pageSize = 1000;
  const devices: DeviceRow[] = [];

  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from('push_devices')
      .select('id, user_id, fcm_token, platform')
      .eq('notifications_enabled', true)
      .order('id')
      .range(from, from + pageSize - 1);

    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query;
    if (error) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Could not load push devices.');
    }

    const page = (data ?? []) as DeviceRow[];
    devices.push(...page);
    if (page.length < pageSize) break;
  }

  return devices;
}

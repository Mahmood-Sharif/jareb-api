import { getFirebaseMessagingConfig, getSupabaseServiceConfig } from '../config/env';
import {
  createFirebasePushClient,
  type FirebasePushClient,
  type PushMessage,
} from '../integrations/firebase/push';
import type { Bindings } from '../types/app';
import { loadActivePushDevices } from './push-devices';
import { createSupabaseServiceClient } from './supabase';

export type PushSendSummary = {
  attempted: number;
  delivered: number;
  failed: number;
  disabled: number;
};

export async function sendPushToUser({
  bindings,
  message,
  userId,
  client,
}: {
  bindings: Bindings;
  message: PushMessage;
  userId: string;
  client?: FirebasePushClient;
}) {
  return sendToDevices({ bindings, message, userId, client });
}

// Internal-only helper for scheduled/admin jobs. It is intentionally not
// mounted as an HTTP route.
export async function broadcastPushToActiveDevices({
  bindings,
  message,
  client,
}: {
  bindings: Bindings;
  message: PushMessage;
  client?: FirebasePushClient;
}) {
  return sendToDevices({ bindings, message, client });
}

async function sendToDevices({
  bindings,
  message,
  userId,
  client,
}: {
  bindings: Bindings;
  message: PushMessage;
  userId?: string;
  client?: FirebasePushClient;
}): Promise<PushSendSummary> {
  const supabase = createSupabaseServiceClient(getSupabaseServiceConfig(bindings));
  const devices = await loadActivePushDevices({ supabase, userId });
  const pushClient =
    client ?? createFirebasePushClient({ config: getFirebaseMessagingConfig(bindings) });
  const summary: PushSendSummary = {
    attempted: devices.length,
    delivered: 0,
    failed: 0,
    disabled: 0,
  };

  for (const device of devices) {
    try {
      const result = await pushClient.send(device.fcm_token, message);
      if (result.accepted) {
        summary.delivered += 1;
      } else {
        summary.failed += 1;
      }

      if (result.invalidToken) {
        summary.disabled += 1;
        await supabase
          .from('push_devices')
          .update({ notifications_enabled: false })
          .eq('id', device.id);
      }
    } catch {
      summary.failed += 1;
    }
  }

  return summary;
}

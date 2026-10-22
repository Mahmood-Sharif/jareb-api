import { getFirebaseMessagingConfig, getSupabaseServiceConfig } from '../config/env';
import {
  createFirebasePushClient,
  diagnosticForPushError,
  type FirebasePushClient,
  type PushDeliveryDiagnostic,
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
  errors: PushSendError[];
};

export type PushSendError = {
  code: string;
  status: string;
  message: string;
};

export async function sendPushToUser({
  bindings,
  message,
  userId,
}: {
  bindings: Bindings;
  message: PushMessage;
  userId: string;
}) {
  return sendToDevices({ bindings, message, userId });
}

// Internal-only helper for scheduled/admin jobs. It is intentionally not
// mounted as an HTTP route.
export async function broadcastPushToActiveDevices({
  bindings,
  message,
}: {
  bindings: Bindings;
  message: PushMessage;
}) {
  return sendToDevices({ bindings, message });
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
    errors: [],
  };

  for (const device of devices) {
    try {
      const result = await pushClient.send(device.fcm_token, message);
      if (result.accepted) {
        summary.delivered += 1;
      } else {
        summary.failed += 1;
      }

      let tokenDisabled = false;
      if (result.invalidToken) {
        summary.disabled += 1;
        const { error } = await supabase
          .from('push_devices')
          .update({ notifications_enabled: false })
          .eq('id', device.id);
        tokenDisabled = error === null;
      }

      if (!result.accepted) {
        const diagnostic =
          result.error ?? diagnosticForPushError(undefined, device.fcm_token);
        summary.errors.push(publicPushError(diagnostic));
        logPushFailure(diagnostic, device.fcm_token, tokenDisabled);
      }
    } catch (error) {
      summary.failed += 1;
      const diagnostic = diagnosticForPushError(error, device.fcm_token);
      summary.errors.push(publicPushError(diagnostic));
      logPushFailure(diagnostic, device.fcm_token, false);
    }
  }

  return summary;
}

function publicPushError(diagnostic: PushDeliveryDiagnostic): PushSendError {
  return {
    code: diagnostic.code,
    status: diagnostic.status,
    message: diagnostic.message,
  };
}

function logPushFailure(
  diagnostic: PushDeliveryDiagnostic,
  token: string,
  tokenDisabled: boolean,
) {
  console.error('FCM delivery failed', {
    httpStatus: diagnostic.httpStatus,
    code: diagnostic.code,
    status: diagnostic.status,
    message: diagnostic.message,
    tokenDisabled,
    tokenSuffix: token.length > 6 ? token.slice(-6) : '[short-token]',
  });
}

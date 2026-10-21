# Push notification testing

The test endpoint is authenticated and always targets only the current Jareb
user. It does not accept a user ID and cannot broadcast.

## Prerequisites

- Apply the reviewed `202610200001_push_devices.sql` migration through the
  normal infrastructure release process.
- Configure `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and
  `FIREBASE_PRIVATE_KEY` as API secrets.
- Build Flutter Web with `FIREBASE_WEB_VAPID_KEY`.
- Deploy the reviewed app and API changes. This document does not perform any
  deployment.

## Flutter Web

1. Open `https://jareb.app`, sign in, and use Settings > Enable notifications.
2. In browser DevTools, verify support and permission:

   ```js
   ({
     notifications: 'Notification' in window,
     serviceWorker: 'serviceWorker' in navigator,
     pushManager: 'PushManager' in window,
     permission: Notification.permission,
   })
   ```

3. Verify the messaging worker is registered:

   ```js
   navigator.serviceWorker.getRegistrations().then((items) =>
     console.table(items.map((item) => ({ scope: item.scope, script: item.active?.scriptURL }))))
   ```

4. Confirm one enabled `web` row exists for the authenticated user. Do not
   copy or expose the full registration token:

   ```sql
   select platform, notifications_enabled, last_seen_at,
          right(fcm_token, 8) as token_suffix
   from public.push_devices
   where user_id = '<AUTH_USER_UUID>';
   ```

5. From DevTools Network, copy the bearer access token from an authenticated
   Jareb API request such as `/me`. Treat it as a password and do not commit or
   share it.
6. Put the Jareb tab in the background, then run:

   ```powershell
   $token = '<CURRENT_SUPABASE_ACCESS_TOKEN>'; Invoke-RestMethod -Method Post -Uri 'https://api.jareb.app/push/test' -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body '{}'
   ```

The response reports `tokens_targeted`, `sent`, and `failed`. A background tab
should receive a system notification. A foreground tab intentionally shows the
existing in-app Jareb toast instead. Tapping the default test notification opens
Home.

## Android

1. Install the Firebase-configured build on a physical device and sign in.
2. Use Settings > Enable notifications and grant the Android 13+ permission.
3. Confirm an enabled `android` row in `public.push_devices`.
4. Background the app and call `POST /push/test` with that user's bearer token.
5. Confirm the system notification arrives and tapping it opens Jareb Home.

## iOS

Before testing, configure the Apple Push Notification service credential in
Firebase and enable the Push Notifications capability plus Background Modes >
Remote notifications for the Runner target/provisioning profile. Then follow
the Android flow and confirm an enabled `ios` row. The Flutter and API paths do
not contain Apple credentials.


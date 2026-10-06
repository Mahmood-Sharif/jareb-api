import type { User } from '@supabase/supabase-js';

export type Bindings = {
  ENVIRONMENT?: string;
  API_VERSION?: string;
  ALLOWED_ORIGINS?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  ACCOUNT_IDENTITY_HMAC_SECRET?: string;
  BIRD_ACCESS_KEY?: string;
  BIRD_WORKSPACE_ID?: string;
  BIRD_CHANNEL_ID?: string;
  SEND_SMS_HOOK_SECRET?: string;
  TARABUT_CLIENT_ID?: string;
  TARABUT_CLIENT_SECRET?: string;
  TARABUT_OAUTH_URL?: string;
};

export type AppVariables = {
  authUser: User;
  authAccessToken: string;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: AppVariables;
};

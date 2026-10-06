# jareb-api production configuration (PREPARED, NOT DEPLOYED)

Nothing here has been run. Each command needs Mahmood's explicit approval.

## What changed in this branch

- `wrangler.jsonc`: `ALLOWED_ORIGINS` is now `https://jareb.app,https://www.jareb.app`
  (was localhost only). `admin.jareb.app` is intentionally **not** listed: jareb-web
  admin talks to Supabase directly today. Add it only when the admin calls this API.
- `src/middleware/cors.ts`: localhost origins are accepted only when
  `ENVIRONMENT !== 'production'`. Previously any `http(s)://localhost` page could call
  the production API cross-origin. Auth is a bearer token (no cookies), so this was
  low risk, but production should only trust its own origins.
- `test/cors.test.ts`: production test (localhost and unknown origins rejected,
  both production origins accepted). `npm test`: 121 passed; `npm run typecheck`: clean.

## Developer impact

Local `wrangler dev` must use `.dev.vars` with `ENVIRONMENT=development`
(already in CONTRIBUTING.md). The committed `wrangler.jsonc` default is production.

## Required Worker secrets (names only; values from Mahmood, never commit)

```powershell
cd jareb-api
npx wrangler secret put SUPABASE_URL                # https://sdzysrydtndqyqbjfocj.supabase.co
npx wrangler secret put SUPABASE_ANON_KEY           # production publishable key
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # production service role key
npx wrangler secret put ACCOUNT_IDENTITY_HMAC_SECRET  # NEW random secret, keep stable forever
npx wrangler secret put BIRD_ACCESS_KEY
npx wrangler secret put BIRD_WORKSPACE_ID
npx wrangler secret put BIRD_CHANNEL_ID
npx wrangler secret put SEND_SMS_HOOK_SECRET        # must equal Supabase Auth Send SMS hook secret
```

`ACCOUNT_IDENTITY_HMAC_SECRET` fingerprints deleted accounts; changing it later breaks
re-registration matching. Use a production-only value, not the dev one.

## Pre-deploy checks (safe, local)

```powershell
npm ci; npm run typecheck; npm test; npm run build   # build = wrangler deploy --dry-run
```

## Deploy (requires explicit approval, AFTER the DB migrations are applied)

The API calls RPCs (`get_customer_drop`, saved drops, account deletion, 5-arg
`update_my_profile`) that do not exist in production until the migrations land.
Deploy the API **after** `jareb-infra` Phase 3, never before.

```powershell
npx wrangler deploy
```

Then add a custom domain (e.g. `api.jareb.app`) in Cloudflare -> Workers -> jareb-api ->
Settings -> Domains (DNS change: Mahmood). Use that URL as `JAREB_API_URL` for Flutter Web.

## Post-deploy verification

```powershell
curl https://<api-host>/health
curl -i -X OPTIONS https://<api-host>/wallet -H "Origin: https://jareb.app" -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: Authorization"
# expect Access-Control-Allow-Origin: https://jareb.app
curl -i -X OPTIONS https://<api-host>/wallet -H "Origin: http://localhost:5173" -H "Access-Control-Request-Method: GET"
# expect NO Access-Control-Allow-Origin
curl -i https://<api-host>/wallet     # expect 401
```

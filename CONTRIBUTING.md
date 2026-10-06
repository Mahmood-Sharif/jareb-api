# Contributing To Jareb API

`jareb-api` is the shared Hono/Cloudflare Worker backend used by the customer app.

For full first-time setup, start with:

```text
C:\dev\code\Jareb\jareb-infra\README.md
```

Expected workspace:

```text
Jareb/
├── jareb-app/
├── jareb-api/
└── jareb-infra/
```

## Prerequisites

Install:

- Git
- GitHub CLI
- Docker Desktop
- Supabase CLI
- Node.js LTS

Flutter is needed when validating app changes that consume API work.

## Install

```powershell
cd C:\dev\code\Jareb\jareb-api
npm install
```

## Local Environment

Create:

```text
C:\dev\code\Jareb\jareb-api\.dev.vars
```

Do not commit it.

Variable names:

```text
ENVIRONMENT
ALLOWED_ORIGINS
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ACCOUNT_IDENTITY_HMAC_SECRET
BIRD_ACCESS_KEY
BIRD_WORKSPACE_ID
BIRD_CHANNEL_ID
SEND_SMS_HOOK_SECRET
JAREB_API_URL
```

Safe placeholder example:

```dotenv
ENVIRONMENT=development
ALLOWED_ORIGINS=http://localhost:63976
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<local publishable key>
SUPABASE_SERVICE_ROLE_KEY=<local service role key>
ACCOUNT_IDENTITY_HMAC_SECRET=<dev secret>
BIRD_ACCESS_KEY=<shared development Bird key>
BIRD_WORKSPACE_ID=<workspace id>
BIRD_CHANNEL_ID=<channel id>
SEND_SMS_HOOK_SECRET=<local hook secret>
JAREB_API_URL=http://127.0.0.1:8787
```

Get local Supabase keys from:

```powershell
cd C:\dev\code\Jareb\jareb-infra
supabase status
```

Bird credentials and hook secrets must be shared privately.

## Local Startup

Start dependencies:

```powershell
cd C:\dev\code\Jareb\jareb-infra
supabase start
```

Start API:

```powershell
cd C:\dev\code\Jareb\jareb-api
npm run dev
```

Expected local API URL:

```text
http://127.0.0.1:8787
```

## Checks

Run before opening a PR:

```powershell
npm run typecheck
npm test
```

Useful scripts:

```powershell
npm run dev
npm run typecheck
npm test
npm run build
```

`npm run build` is a dry-run Worker build. It does not deploy.

## Branch Workflow

```powershell
git checkout main
git pull origin main
git checkout -b feature/<short-name>
```

After work:

```powershell
npm run typecheck
npm test
git status
git add <intended files>
git commit -m "..."
git push -u origin feature/<short-name>
```

Open a PR. Do not force push `main`.

## API And Database Boundaries

Use the correct repo:

- API contracts, validation, response shaping, external integrations: `jareb-api`
- schema, RLS, indexes, triggers, transactional RPCs, seed data: `jareb-infra`
- UI/client state: `jareb-app`

Do not replace database-critical behavior in TypeScript unless the API preserves the database guarantees.

If an API change requires a migration, create a linked `jareb-infra` PR.

## Security

Never commit:

- `.dev.vars`
- `.env` files
- Supabase service-role keys
- Bird access keys
- Send SMS hook secrets
- GitHub tokens
- real customer phone numbers
- real receipts
- OTP values outside intentional local config
- auth tokens

Use placeholders in tests/docs unless the value is an intentional local fixture.

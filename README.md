# Jareb API

Jareb API is the shared application backend for Jareb.

It is not owned by the Flutter client. It is the backend layer intended to serve both current and future Jareb clients.

## Current Stack

- TypeScript
- Hono
- Cloudflare Workers
- Supabase JS
- Zod
- Vitest
- Wrangler

## Implemented Endpoints

- `GET /health`
- `GET /me`

## Authentication

```text
Supabase Auth
-> access token
-> Authorization: Bearer <token>
-> Jareb API
```

`GET /me` validates the authenticated Supabase user and returns safe current-user/profile data. It does not accept a user ID from the request.

## Layering

Database responsibilities stay in Supabase where they protect data integrity:

- RLS
- constraints
- indexes
- triggers
- transactional RPCs
- row locking
- data integrity

API responsibilities live in this Worker:

- authentication
- API contracts
- validation
- response shaping
- orchestration
- Tarabut later
- payouts later
- external integrations

Database-critical RPCs should not be blindly rewritten into TypeScript. Move behavior feature by feature only when the API can preserve the database guarantees.

## Future Clients

```text
jareb-web --+
            +-> jareb-api
jareb-app --+
```

## Environment

Current implemented variable names:

- `ENVIRONMENT`
- `API_VERSION`
- `ALLOWED_ORIGINS`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

The real Supabase project uses a publishable key. The current API implementation still names that binding `SUPABASE_ANON_KEY`; put the publishable key there until the API binding is renamed in a separate compatibility pass.

`SUPABASE_SERVICE_ROLE_KEY` is optional and is not required for the current `/me` feature.

Local Worker secrets can live in `.dev.vars`; it is ignored by Git.

## Development

```powershell
npm install
npm run typecheck
npm test
npm run build
```

## Related Repositories

- `jareb-web`: current live web product. It still talks directly to Supabase/RPCs today.
- `jareb-app`: future Flutter customer app that calls this API after Supabase Auth.

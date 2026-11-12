# corkboard-api

Backend for **Corkboard**, a collaborative whiteboard where a model you bring (any provider) can group notes, draft action items and build timelines. The frontend is [corkboard-ui](https://github.com/adamstavely/corkboard-ui).

NestJS, Postgres (Drizzle), and sign-in through any OpenID Connect provider. Real-time sync (Hocuspocus), Elastic search and the model layer arrive in later phases.

## Run it locally

```bash
docker compose up -d          # Postgres on 5440, Keycloak on 8280
cp .env.example .env
npm install
npm run start:dev             # http://localhost:3700, API docs at /docs
```

Migrations run when the API starts. Sign in through the UI as `ada` or `grace` (password `corkboard`); the Keycloak admin console is at http://localhost:8280 (admin/admin).

## How it fits together

- **Identity:** every request carries an access token from the OIDC provider (`OIDC_ISSUER`, optionally `OIDC_AUDIENCE`). A person's first request creates their user and a workspace they administer.
- **Workspaces (orgs):** boards belong to a workspace. Admins will configure the workspace's model providers; members use them. A board in a workspace you're not in is reported as not found.
- **Boards:** metadata in `boards`, content in `board_documents` as one encoded Yjs update. Until real-time sync lands, the UI loads and saves the whole document through `/boards/{id}/document`.

## Commands

| | |
|---|---|
| `npm test` | Unit tests |
| `npm run test:int` | Integration tests against Postgres in Testcontainers (needs Docker) |
| `npm run lint` / `npm run typecheck` | |
| `npm run db:generate` | Write a migration after changing `src/db/schema.ts`; commit `drizzle/` |
| `npm run db:migrate` | Apply migrations (for deploys with `MIGRATE_ON_START=false`) |
| `npm run openapi:export` | Regenerate `openapi.json`, the UI's contract; CI fails if it's stale |

# corkboard-api

Backend for **Corkboard**, a collaborative whiteboard where a model you bring (any provider) can group notes, draft action items and build timelines. The frontend is [corkboard-ui](https://github.com/adamstavely/corkboard-ui).

NestJS, Postgres (Drizzle), real-time sync with Hocuspocus, search with Elasticsearch, and sign-in through any OpenID Connect provider. The model layer arrives in a later phase.

## Run it locally

```bash
docker compose up -d          # Postgres on 5440, Elasticsearch on 9210, Keycloak on 8280
cp .env.example .env
npm install
npm run start:dev             # http://localhost:3700, API docs at /docs
```

Migrations run when the API starts. Sign in through the UI as `ada` or `grace` (password `corkboard`); the Keycloak admin console is at http://localhost:8280 (admin/admin).

## How it fits together

- **Identity:** every request carries an access token from the OIDC provider (`OIDC_ISSUER`, optionally `OIDC_AUDIENCE`). A person's first request creates their user and a workspace they administer.
- **Workspaces (orgs):** boards belong to a workspace. A board in a workspace you're not in is reported as not found. Admins invite people by email (`POST /orgs/{orgId}/invites`), change roles and remove people; anyone can leave; a workspace always keeps one admin. An invite is matched to the person who signs in with that email, and only when the identity provider has verified it (`email_verified`). They accept or decline it from `GET /me/invites`. Admins will also configure the workspace's model providers.
- **Boards:** metadata in `boards`, content in `board_documents` as one encoded Yjs update.
- **Real-time sync:** clients connect to the WebSocket at `/collab` (the UI reaches it as `/api/collab`), with the board id as the document name and their access token. Hocuspocus checks they can see the board, loads it from Postgres, relays changes and presence between everyone on it, and saves it 2 seconds after the last change (at least every 10 seconds while editing continues) and when the last person leaves. Deleting a board disconnects everyone on it. `GET /boards/{id}/document` returns the last saved state, read-only.
- **Search:** after each save, the board's title and the plain text of its notes go into the `corkboard-boards` index. `GET /orgs/{orgId}/search?q=` finds boards in a workspace, with highlighted passages. Postgres stays the source of truth: if Elasticsearch is down, search fails but nothing else does, and `npm run search:reindex` rebuilds the index.

## Commands

| | |
|---|---|
| `npm test` | Unit tests |
| `npm run test:int` | Integration tests against Postgres and Elasticsearch in Testcontainers (needs Docker), including live sync over the socket |
| `npm run lint` / `npm run typecheck` | |
| `npm run db:generate` | Write a migration after changing `src/db/schema.ts`; commit `drizzle/` |
| `npm run db:migrate` | Apply migrations (for deploys with `MIGRATE_ON_START=false`) |
| `npm run search:reindex` | Rebuild the search index from Postgres |
| `npm run openapi:export` | Regenerate `openapi.json`, the UI's contract; CI fails if it's stale |

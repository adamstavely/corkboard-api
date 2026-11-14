# corkboard-api

Backend for **Corkboard**, a collaborative whiteboard where a model you bring (any provider) can group notes, draft action items and build timelines. The frontend is [corkboard-ui](https://github.com/adamstavely/corkboard-ui).

NestJS, Postgres (Drizzle), real-time sync with Hocuspocus, search with Elasticsearch, passkey sign-in (with a people picker for local development), and an assistant that works with whichever model a workspace brings.

## Run it locally

```bash
docker compose up -d          # Postgres on 5440, Elasticsearch on 9210
cp .env.example .env
npm install
npm run start:dev             # http://localhost:3700, API docs at /docs
```

Migrations run when the API starts. Open the UI, pick who you are or add yourself, and go.

## How it fits together

- **Identity:** people sign up and in with passkeys (WebAuthn): `POST /auth/sign-up/options` then `/auth/sign-up/verify`, and `POST /auth/sign-in/options` then `/auth/sign-in/verify`. Each returns a session token (`cbs_…`, 30 days; only its hash is stored) to send as `Authorization: Bearer <token>`. The collaboration socket takes the same token. `POST /auth/sign-out` ends it, and `/me/passkeys` adds or removes passkeys (never the last). Set `WEBAUTHN_RP_ID` to the UI's host name and `WEBAUTHN_ORIGINS` to its origins (defaults: `localhost`, `http://localhost:4300`). Emails aren't verified yet.
- **Development picker:** with `PEOPLE_PICKER=true` (the default unless `NODE_ENV=production`), `GET /people` lists everyone and `POST /people` adds someone. A picked person's id then works as their bearer token, and someone added this way can claim their account with a passkey. `GET /auth/config` tells the UI whether the picker is on. Never turn it on anywhere shared.
- **Workspaces (orgs):** boards belong to a workspace. A board in a workspace you're not in is reported as not found. Admins invite people by email (`POST /orgs/{orgId}/invites`), change roles and remove people; anyone can leave; a workspace always keeps one admin. An invite is matched to the person with that email. They accept or decline it from `GET /me/invites`. Admins will also configure the workspace's model providers.
- **Boards:** metadata in `boards`, content in `board_documents` as one encoded Yjs update.
- **Real-time sync:** clients connect to the WebSocket at `/collab` (the UI reaches it as `/api/collab`), with the board id as the document name and their person id as the token. Hocuspocus checks they can see the board, loads it from Postgres, relays changes and presence between everyone on it, and saves it 2 seconds after the last change (at least every 10 seconds while editing continues) and when the last person leaves. Deleting a board disconnects everyone on it. `GET /boards/{id}/document` returns the last saved state, read-only.
- **Models (bring your own):** a workspace's admins connect models at `/orgs/{orgId}/models`. A connection is either Claude (Anthropic's Messages API, through `@anthropic-ai/sdk`) or any server that speaks OpenAI's Chat Completions API with tool calling (OpenAI, Azure, Gemini, OpenRouter, vLLM, Ollama, LM Studio). Keys are encrypted at rest with `MODEL_KEY_SECRET` (AES-256-GCM) and never returned. Cloud metadata addresses are refused. `POST …/models/{id}/test` checks a connection and says whether the key, the model or the address is at fault.
- **Assistant:** `POST /boards/{id}/assist` gives the chosen model the board's notes (or just the selected ones) as data, and two tools: `add_notes` and `set_note_color`. It runs on the live document, so its notes appear for everyone at once, and the server decides where they go. Both adapters share one tool definition. On Claude, tools are `strict` and never forced, and refusal fallbacks (`fallbacks: "default"`) are on for models that support them.
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

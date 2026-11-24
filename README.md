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

Deploying it: read [docs/OPERATIONS.md](docs/OPERATIONS.md) first. It must run as **one instance**, and it covers what
"Saved" promises, backups, limits, what share links expose, and what to watch.

## How it fits together

- **Identity:** people sign up and in with passkeys (WebAuthn): `POST /auth/sign-up/options` then `/auth/sign-up/verify`, and `POST /auth/sign-in/options` then `/auth/sign-in/verify`. Each returns a session token (`cbs_…`, 30 days; only its hash is stored) to send as `Authorization: Bearer <token>`. The collaboration socket takes the same token. `POST /auth/sign-out` ends it, and its live board connections with it, and `/me/passkeys` adds or removes passkeys (never the last). Set `WEBAUTHN_RP_ID` to the UI's host name and `WEBAUTHN_ORIGINS` to its origins (defaults: `localhost`, `http://localhost:4300`). Emails aren't verified, so nothing is granted on an email alone.
- **Development picker:** with `PEOPLE_PICKER=true` (the default unless `NODE_ENV=production`), `GET /people` lists everyone and `POST /people` adds someone. A picked person's id then works as their bearer token, and someone added this way can claim their account with a passkey. `GET /auth/config` tells the UI whether the picker is on. Never turn it on anywhere shared.
- **Workspaces (orgs):** boards belong to a workspace, where everyone is a reader, commenter, updater or owner. A board in a workspace you're not in is reported as not found. Owners invite people (`POST /orgs/{orgId}/invites` returns a one-time `token`; send the person the link `/invite/{token}`), change roles and remove people; anyone can leave; a workspace always keeps one owner. The person joins with `POST /invites/accept` and the token (`POST /invites/lookup` says what it's for). With the development picker on, invites are also matched by email (`GET /me/invites`).
- **Boards:** metadata in `boards`, content in `board_documents` as one encoded Yjs update.
- **Real-time sync:** clients connect to the WebSocket at `/collab` (the UI reaches it as `/api/collab`), with the board id as the document name and their session token as the token (or `link:<token>` for a share link's guest). Hocuspocus checks they can see the board, loads it from Postgres, relays changes and presence between everyone on it, and saves it 2 seconds after the last change (at least every 10 seconds while editing continues) and when the last person leaves, and every open board as the API stops. Deleting a board disconnects everyone on it. Changes that only the API may make (chat, votes, facilitation, the model's history), that depend on something the server doesn't have, or that would write a malformed node are refused. `GET /boards/{id}/document` returns the last saved state, read-only.
- **Site admins (`SITE_ADMIN_EMAILS`):** they connect the AI models (`/site/models`), set the web search service (`/site/search`) and keep the cloud icon library (`/site/logo-packs`) for every workspace. That is all the role allows: it opens no workspace or board, and nothing it sees says which workspaces exist; site admins are on boards only when invited, like anyone.
- **Models:** the site's admins connect models at `/site/models`; each workspace's owners switch on the ones its people use (`/orgs/{orgId}/models/choices`, `PUT …/models/{id}/enabled`). A connection is either Claude (Anthropic's Messages API, through `@anthropic-ai/sdk`) or any server that speaks OpenAI's Chat Completions API with tool calling (OpenAI, Azure, Gemini, OpenRouter, vLLM, Ollama, LM Studio). Keys are encrypted at rest with `MODEL_KEY_SECRET` (AES-256-GCM) and never returned. Cloud metadata addresses are refused. `POST /site/models/{id}/test` checks a connection and says whether the key, the model or the address is at fault.
- **Model evals:** `npm run eval` runs saved cases against a real model through the app's own endpoints, prompts and tools. The cases cover grouping a retro, action items with owners, a plan as a timeline, a read-only question, matrix scores, the summary, a session recap, and questions about marked places on an image. Each is graded by checks on what the model did to the board. Set `EVAL_API_KEY` (and optionally `EVAL_MODEL`, default `claude-opus-5-5`; or `EVAL_KIND=openai` with `EVAL_BASE_URL`). Without a key every case is skipped. It never runs in CI by itself, because each run costs money; the **Model evals** workflow runs it by hand with the `EVAL_API_KEY` secret.
- **Assistant:** `POST /boards/{id}/assist` gives the chosen model the board's notes (or just the selected ones) as data, and tools to add notes, group them into frames, draft action items, make a timeline, point to notes, score them on the matrix and recolour them. It runs on the live document, so its notes appear for everyone at once, and the server decides where they go. Both adapters share one tool definition. On Claude, tools are `strict` and never forced, and refusal fallbacks (`fallbacks: "default"`) are on for models that support them.
- **Agents (MCP and the agent API):** people make personal access tokens (`cbp_…`, scoped, hashed, revocable) under `/me/tokens`. With one, agents like Claude Code and Cursor list, read and search boards, propose changes and comment through the MCP server at `/mcp` (streamable HTTP, stateless) or the REST API under `/v1`. Their changes always wait as suggestions for people to accept. Tokens work nowhere else. See [docs/mcp.md](docs/mcp.md).
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

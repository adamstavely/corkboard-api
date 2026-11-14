# Running Corkboard

What a deployment needs to know: the shape it must have, what "Saved" promises, how to back it up, what's limited
and what isn't, what a share link exposes, and what to watch. Written after the production-readiness review of
14 November 2026; [the review's findings](#review-findings) are tracked at the end.

## Shape: one API instance

Live collaboration runs in the API process: each open board is a Yjs document in that process's memory (Hocuspocus),
saved to Postgres by replacing the board's stored state. **Run exactly one API instance.**

- Two instances would each hold their own copy of a board open on both, and each save would overwrite the other's.
  Nothing coordinates documents between instances. Sticky sessions don't help: the API's own changes (the assistant,
  facilitation, restores) and access revocations happen on whichever instance gets the HTTP request.
- Deploy by **recreating** the instance (stop, then start), not rolling. The old instance saves every open board
  as it stops; give it 30 seconds before it's killed.
- Notifications use Postgres LISTEN/NOTIFY and would work across instances; boards would not.

## Configuration

| Variable | |
|---|---|
| `NODE_ENV=production` | Turns the development people picker off (`PEOPLE_PICKER` can't be true in production). Sign-in is then passkeys only. |
| `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGINS` | The UI's host name, and its origin(s) exactly as the browser sends them. Test sign-up behind the real reverse proxy. |
| `MODEL_KEY_SECRET` | 32 random bytes (base64) that encrypt model keys and tracker tokens. **Back it up separately from the database**: without it, every stored key and token is unreadable and must be entered again. |
| `DATABASE_URL`, `ES_NODE` | Postgres is the source of truth (boards, files, everything). Elasticsearch is only search; `npm run search:reindex` rebuilds it. |
| `MIGRATE_ON_START` | `true` runs migrations at start; with `false`, run `npm run db:migrate` before starting. |

## What "Saved" means

- The board shows **Saved** when the API has acknowledged every change. The API writes the board to Postgres
  2 seconds after the last change, and at least every 10 seconds while editing goes on. A **crash** (not a normal
  stop) can lose up to the last 10 seconds of acknowledged changes.
- A **normal stop** saves every open board first (and finishes even with browsers connected).
- The browser keeps a board's unsent changes (IndexedDB) until the API has them, so edits made offline survive
  leaving the board or reloading, and are sent when it's next open. Signing out clears them.
- If the API keeps refusing a browser's changes (for instance changes that carry chat or votes the API lost in a
  crash, which it can't tell from forgeries), the board says so after 20 seconds and offers to reload from the
  server, dropping what wasn't accepted.

## Backups and restore

- **Back up Postgres.** It holds everything, attached files included (`board_files.data`). Pick a frequency for the
  data you can afford to lose (RPO) and test restoring into a fresh instance on a schedule (with `MODEL_KEY_SECRET`).
- The workspace **data export** (Admin) is not a backup and can't be restored. It says so in the file (`kind:
  "partial-data-export"`, `leavesOut`): file contents, board-by-board access, versions and history, and rich text
  formatting aren't in it.
- Board versions and uploads have no retention limit or quota yet; watch the database's size.

## Limits, and what's missing

In place:

- Model requests: at most 4 at once per workspace (per instance), 2 minutes per call and 5 per request, no more than
  25 tool calls in one answer, all stopped when the API stops.
- Files: 10 MB each. Collaboration messages: 16 MB each.
- Link previews and issue trackers reach public addresses only (every IPv4 and IPv6 form is checked). Model
  connections are exempt on purpose: owners may point one at a local server.

Not in place (put these in front of the API, or build them):

- **Spend caps** per workspace on model use (usage is recorded in `model_usage`; nothing enforces a budget).
- **Rate limits** on sign-up, sign-in challenges, invites and link previews. Use the reverse proxy.
- **Storage quotas** per workspace.
- **Durable model jobs**: a request in progress when the API stops is stopped, not resumed.

## What a share link exposes

A share link's guest receives **the whole board document**, not only what the shared page shows: notes and frames,
and also the board's chat, votes and facilitation state, comments' positions, the model's change history and the
summary. The page hides those, but they're in the data the browser receives. Don't share a board by link if its chat
or history mustn't leave the workspace.

An editable link lets guests change notes, frames, shapes and tasks; chat, votes and settings stay with signed-in
people.

## Identity

- Passkeys only in production. Email addresses are what people typed at sign-up; nothing verifies them.
- So an invite joins through its link (a one-time secret), never by matching an email. Send the link to the person
  yourself.
- Signing out ends that session's live board connections at once; an expired or ended session is let go within
  30 seconds anywhere.

## Watching it

There is: request and warning logs (`[Collab] Refused …` when a client's change is refused), and `GET /health`
(Postgres reachable).

Worth adding before relying on it: save lag and save failures per board, collaboration connections and refusals,
model latency, errors and spend per workspace, and alerts on each. Logs carry no request id yet.

## Review findings

| # | Finding | Status |
|---|---|---|
| 1 | Unverified emails could claim invites | Fixed: invites join by link (#41) |
| 2 | Deferred Yjs updates bypassed the server-owned guard | Fixed: unresolved updates refused (#42) |
| 3 | Mapped IPv6 bypassed the private-address guard | Fixed: byte-level checks, trackers too (#43) |
| 4 | AI undo deleted human edits | Fixed (#42) |
| 5 | Sign-out didn't end live connections | Fixed (#41) |
| 6 | A malformed node broke the board | Fixed: refused by the API (#42), skipped by the UI (corkboard-ui #53) |
| 7 | Leaving a board dropped offline edits | Fixed: kept in the browser, guarded (corkboard-ui #56); shutdown now saves (#47) |
| 8 | Concurrent exports made duplicate issues | Fixed: claimed per task (#45) |
| 9 | Reveal could lose accepted notes | Fixed: round lifecycle in the database (#45) |
| 10 | Two passkey removals could remove the last | Fixed: per-person lock (#41) |
| 11 | Recap tool schema broke strict providers | Fixed, with a contract test for every tool (#43) |
| 12 | List content lost in exports and tasks | Fixed (corkboard-ui #56) |
| 13 | The export wasn't a backup | Labelled as a partial export (#46, corkboard-ui #56); a restorable archive is not built |
| 14 | Undo restore could restore someone else's backup | Fixed: bound to the version it saved (#45, corkboard-ui #56) |
| 15 | A failed expiry check left guests connected | Fixed: fails closed (#45) |
| 16 | Model requests had no deadline | Fixed: deadlines, per-workspace limit, shutdown (#44); spend caps not built |

Design work still open: keeping server-owned state (chat, votes, facilitation, history) in a document of its own
that clients only read, which would remove the guard as a security boundary and limit what share links expose;
multi-instance collaboration; email verification; and the gaps listed under limits and watching.

# Agents: MCP and the agent API

Agents such as Claude Code, Cursor and Claude Desktop can work with Corkboard boards: list them, read them, search them,
propose changes and comment. They never change a board directly. What an agent proposes waits on the board as a
suggestion, named "Cursor for Ada", until an updater or owner accepts or turns it down.

## 1. Make an access token

In Corkboard, open **Account**, then **Access tokens**, and choose **New token**:

- **Name:** the agent that will use it ("Cursor", "Claude Code"). Boards show this name on its suggestions and comments.
- **Scopes:**
  - `boards:read`: list, read and search boards.
  - `boards:propose`: propose changes. Your role on a board still applies, so you must be an updater or owner there.
  - `comments:write`: comment on notes, frames and other items. You must be a commenter or above.
- **Expiry:** 7, 30 or 90 days, a year, or never.

The token (`cbp_…`) is shown once. Copy it then. Corkboard keeps only a hash of it, so it can't show it again. The
list shows each token's first characters and when it was last used, and **Revoke** stops one at once.

A token acts as you, with your access to each board. It works only on the agent API (`/v1/…`) and on `/mcp`. It can't
open the rest of the API, change your settings or make more tokens. People on share links can't make tokens.

## 2. Connect your agent

Below, `https://corkboard.example.com/api` stands for wherever your Corkboard API is served. In local development
that's `http://localhost:3700`.

**Claude Code**

```bash
claude mcp add --transport http corkboard https://corkboard.example.com/api/mcp \
  --header "Authorization: Bearer cbp_…"
```

**Cursor** (`~/.cursor/mcp.json`, or `.cursor/mcp.json` in a project)

```json
{
  "mcpServers": {
    "corkboard": {
      "url": "https://corkboard.example.com/api/mcp",
      "headers": { "Authorization": "Bearer cbp_…" }
    }
  }
}
```

**Other MCP clients:** use streamable HTTP at `/mcp` and send the token as `Authorization: Bearer cbp_…`. The server is
stateless, so each request is POSTed on its own, with no session to resume. A GET or DELETE returns 405.

Keep the token out of files you commit. Claude Code stores it in your user settings, and for Cursor use your home
directory's `mcp.json`.

## Tools

| Tool | Scope | What it does |
|---|---|---|
| `list_boards` | `boards:read` | The boards you can open, in all your workspaces, with your role on each |
| `search_boards` | `boards:read` | Boards whose title or notes match, with matching passages |
| `read_board` | `boards:read` | A board as an outline: frames with their notes, other notes, everything else by kind, tasks, and waiting suggestions |
| `propose_changes` | `boards:propose` | One suggestion that can add notes (loose or in a frame), make frames that group existing and new notes, add tasks and draw a Mermaid diagram |
| `add_comment` | `comments:write` | A comment on a note, frame or other item, shown as yours via the agent |

A refused call comes back as a tool error in plain words. Examples are a missing scope, or "Rhea is a reader on this
board, so Claude can read it but not propose changes."

## The agent API (REST)

The same operations are available over HTTP, with the same token and the same rules. The full schemas are in
`openapi.json` and at `/docs`, under **agents**.

| | |
|---|---|
| `GET /v1/boards` | List boards |
| `GET /v1/boards/{id}` | Read a board as an outline |
| `GET /v1/search?q=` | Search boards |
| `POST /v1/boards/{id}/proposals` | Propose changes: `{ summary?, notes?, frames?, tasks?, diagram? }` |
| `POST /v1/boards/{id}/comments` | Comment: `{ itemId, body }` |

```bash
curl -H "Authorization: Bearer $CORKBOARD_TOKEN" https://corkboard.example.com/api/v1/boards
```

## Limits and records

- Each token can make 60 calls at once, then 2 a second. Past that it gets a 429 with `Retry-After`. The limit is held
  in the API's memory, which suits its single instance (see OPERATIONS.md).
- One proposal holds at most 50 new notes, 12 frames and 30 tasks. A board keeps its 20 newest waiting suggestions.
- Reads, proposals and comments go in the board's activity log as you, via the agent, for example "Ada via Cursor
  proposed a change". Listing and searching boards aren't tied to one board, so they aren't recorded.

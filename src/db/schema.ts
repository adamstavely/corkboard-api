import type { SyncedState } from '../integrations/tracker-sync';
import { type AnyPgColumn, boolean, customType, integer, index, jsonb, pgEnum, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/** Raw bytes; Yjs state is stored as-is. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** People. There's no sign-in: whoever opens Corkboard picks who they are, or adds themselves. Email is stored lower-cased. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  /** The assistant suggests changes for them to accept, instead of making them. */
  assistantAsksFirst: boolean('assistant_asks_first').notNull().default(false),
  createdAt: createdAt(),
});

export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** The workspace's look for diagrams (themes/diagram-theme.ts); none: Trench Coat's. */
  diagramTheme: jsonb('diagram_theme').$type<Record<string, unknown>>(),
  createdAt: createdAt(),
});

/**
 * What someone may do, least first: read, comment, change content, or also manage (members, sharing, models, deleting).
 * A workspace role is the default on every board in it; see `boardMembers`.
 */
export const orgRole = pgEnum('org_role', ['reader', 'commenter', 'updater', 'owner']);

export const orgMembers = pgTable(
  'org_members',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: orgRole('role').notNull().default('updater'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

/**
 * Someone asked to join a workspace, by email. They see it once they sign in with that email, and accept or decline it
 * there. One open invite per email per workspace.
 */
export const orgInvites = pgTable(
  'org_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    /** Lower-cased. */
    email: text('email').notNull(),
    role: orgRole('role').notNull().default('updater'),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    /**
     * The SHA-256 of the invite link's secret. Holding the link is what lets someone join: an email typed at sign-up
     * proves nothing about the mailbox. Null for invites made before links, which only the development picker can take.
     */
    tokenHash: text('token_hash'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('org_invites_org_email').on(t.orgId, t.email),
    index('org_invites_email').on(t.email),
    uniqueIndex('org_invites_token').on(t.tokenHash),
  ],
);

/** Which API a model connection speaks: Anthropic's Messages API, or OpenAI's Chat Completions (any compatible server). */
export const providerKind = pgEnum('provider_kind', ['anthropic', 'openai']);

/**
 * A model a workspace's admins connected: its API, model id and, for OpenAI-compatible servers, where it lives. The
 * key is encrypted at rest (see SecretBox) and never leaves the API.
 */
export const modelProviders = pgTable('model_providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  kind: providerKind('kind').notNull(),
  model: text('model').notNull(),
  baseUrl: text('base_url'),
  apiKeyEncrypted: text('api_key_encrypted'),
  /** What the workspace pays per million input and output tokens, if an owner has said, for estimating spend. */
  priceInPerMillion: real('price_in_per_million'),
  priceOutPerMillion: real('price_out_per_million'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

export const boards = pgTable('boards', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  /** The folder it's filed in, if any; deleting the folder leaves it unfiled. */
  folderId: uuid('folder_id').references((): AnyPgColumn => boardFolders.id, { onDelete: 'set null' }),
  /** The board this one carries on from: last sprint's retro, say. */
  continuesId: uuid('continues_id').references((): AnyPgColumn => boards.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Folders a workspace files its boards in. */
export const boardFolders = pgTable('board_folders', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

/** Boards someone starred, to find them first. */
export const boardStars = pgTable(
  'board_stars',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.boardId] })],
);

/** When someone last opened each board, for their recently opened list. */
export const boardVisits = pgTable(
  'board_visits',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    visitedAt: timestamp('visited_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.boardId] })],
);

/** Links that let anyone who has them view a board, live and read-only, without picking who they are. */
export const boardShareLinks = pgTable('board_share_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  boardId: uuid('board_id')
    .notNull()
    .references(() => boards.id, { onDelete: 'cascade' }),
  /** The secret in the link. */
  token: text('token').notNull().unique(),
  label: text('label'),
  /** Whoever has the link can change the board (add, move, write), not just look; never chat, votes or settings. */
  canEdit: boolean('can_edit').notNull().default(false),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  opens: integer('opens').notNull().default(0),
  lastOpenedAt: timestamp('last_opened_at', { withTimezone: true }),
  /** A scrypt hash ("scrypt$salt$hash", base64url): guests type the password before the link opens anything. */
  passwordHash: text('password_hash'),
  /** Made for embedding the board elsewhere (Notion, Confluence): read-only, no password; reused while it's live. */
  embed: boolean('embed').notNull().default(false),
  createdAt: createdAt(),
});

/** What participants from outside the team see of each other's feedback; the team always sees everything, named. */
export const feedbackVisibility = pgEnum('feedback_visibility', ['names', 'anonymous', 'own']);

/**
 * A board's feedback link: anyone signed in who has it can join the board as a participant, from any workspace, to
 * comment, add notes, react, vote and answer polls. One live link per board.
 */
export const boardFeedbackLinks = pgTable(
  'board_feedback_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    /** The secret in the link. */
    token: text('token').notNull().unique(),
    visibility: feedbackVisibility('visibility').notNull().default('anonymous'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('board_feedback_links_board').on(t.boardId)],
);

/**
 * Someone from outside the board's workspace who joined it through its feedback link. Their pseudonym ("Participant 4")
 * is what other participants see when names are hidden; it stays theirs on that board.
 */
export const boardParticipants = pgTable(
  'board_participants',
  {
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pseudonym: integer('pseudonym').notNull(),
    linkId: uuid('link_id').references(() => boardFeedbackLinks.id, { onDelete: 'set null' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set by the team to keep someone out. */
    blockedAt: timestamp('blocked_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.boardId, t.userId] }), uniqueIndex('board_participants_pseudonym').on(t.boardId, t.pseudonym), index('board_participants_user').on(t.userId)],
);

/** A board role for one person, set on the board: any role, or none at all to keep them out. */
export const boardAccess = pgEnum('board_access', ['none', 'reader', 'commenter', 'updater', 'owner']);

/**
 * Board-level roles that replace someone's workspace role on one board, raising or lowering it. Only for members of
 * the board's workspace; workspace owners are owners of every board whatever this says.
 */
export const boardMembers = pgTable(
  'board_members',
  {
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: boardAccess('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.boardId, t.userId] }), index('board_members_user').on(t.userId)],
);

/**
 * The conversation about one note or frame (its id in the board's document). Resolved threads stay, folded away; a new
 * comment reopens one.
 */
export const commentThreads = pgTable(
  'comment_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    /** For a comment pinned to a spot on an image: where, as fractions of its width and height. */
    anchorX: real('anchor_x'),
    anchorY: real('anchor_y'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('comment_threads_board_node').on(t.boardId, t.nodeId)],
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => commentThreads.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    /** The agent that wrote it for its author, through one of their access tokens ("Cursor"); null when they wrote it. */
    via: text('via'),
    createdAt: createdAt(),
  },
  (t) => [index('comments_thread').on(t.threadId, t.createdAt)],
);

/** A board's content: the Yjs document, encoded as one update. Kept apart from `boards` so listing stays light. */
export const boardDocuments = pgTable('board_documents', {
  boardId: uuid('board_id')
    .primaryKey()
    .references(() => boards.id, { onDelete: 'cascade' }),
  state: bytea('state').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Mini-apps the assistant made on a board: small, self-contained web pages that show or work with the board's notes.
 * The board's document places them (an `app` item names its app and version); the code lives here, every version kept.
 */
export const boardApps = pgTable(
  'board_apps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('board_apps_board').on(t.boardId)],
);

/** One version of a mini-app's code, numbered from 1. */
export const boardAppVersions = pgTable(
  'board_app_versions',
  {
    appId: uuid('app_id')
      .notNull()
      .references(() => boardApps.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    html: text('html').notNull(),
    /** What changed, in a line: "Made it", "Added a chart", "Restored version 2". */
    note: text('note').notNull(),
    /** The model that wrote it, if one did. */
    model: text('model'),
    /** Set while it's only suggested ("ask me first"): hidden from the app's versions until accepted, deleted if turned down. */
    suggestionId: uuid('suggestion_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.appId, t.version] })],
);

/** Images and files dropped on a board. The board's document places them; the bytes live here. */
export const boardFiles = pgTable(
  'board_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    data: bytea('data').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('board_files_board').on(t.boardId)],
);

/** The text the assistant can search and read in a board's file, taken out once when it's added. */
export const boardFileTexts = pgTable(
  'board_file_texts',
  {
    fileId: uuid('file_id')
      .primaryKey()
      .references(() => boardFiles.id, { onDelete: 'cascade' }),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    /** How many pieces it's searched in. */
    chunks: integer('chunks').notNull(),
    extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('board_file_texts_board').on(t.boardId)],
);

/** Who did what on a board, newest last: the board's activity. Kept when the person is gone. */
export const boardEvents = pgTable(
  'board_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    /** The name at the time, so the record reads right after they change it or leave. */
    actorName: text('actor_name').notNull(),
    /** A past-tense verb: "renamed", "commented on". */
    action: text('action').notNull(),
    target: text('target'),
    detail: text('detail'),
    /**
     * Who did it shows only to the board's owners (and in the workspace's audit export): it was meant to be anonymous on
     * the board, like a note from an anonymous writing round. It's recorded all the same.
     */
    restricted: boolean('restricted').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('board_events_board').on(t.boardId, t.createdAt)],
);

/**
 * Close-together states of a board while people edit it, to replay how it grew (see replay-chain.ts). Most rows hold
 * only what changed since the row before (`depth` > 0); every so often one holds the whole state (`depth` 0), so a
 * replay never reads far back. Capped per board, and pruned under the workspace's retention policy.
 */
export const boardSnapshots = pgTable(
  'board_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    /** The whole state (depth 0), or a Yjs update with what changed since the row before. */
    state: bytea('state').notNull(),
    /** The board's Yjs state vector at this point, so the next row can hold only what changed. */
    vector: bytea('vector').notNull(),
    /** Rows since the last whole state: 0 for a whole state. */
    depth: integer('depth').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('board_snapshots_board').on(t.boardId, t.createdAt)],
);

/** Saved states of a board's document, to look back at and restore. */
export const boardVersions = pgTable(
  'board_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    state: bytea('state').notNull(),
    /** Null for the saves made as people edit. */
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    label: text('label').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('board_versions_board').on(t.boardId, t.createdAt)],
);

/** Things someone should hear about: a mention, a reply, an answer, an invite. */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    boardId: uuid('board_id').references(() => boards.id, { onDelete: 'cascade' }),
    /** mention, reply, answer or invite. */
    kind: text('kind').notNull(),
    actorName: text('actor_name'),
    title: text('title').notNull(),
    body: text('body'),
    /** Where it happened: a board's title, a workspace's name. */
    context: text('context'),
    /** A path in the app to open. */
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user').on(t.userId, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Org = typeof orgs.$inferSelect;
export type Board = typeof boards.$inferSelect;
export type OrgRole = (typeof orgRole.enumValues)[number];
export type BoardAccess = (typeof boardAccess.enumValues)[number];
export type OrgInvite = typeof orgInvites.$inferSelect;
export type ModelProvider = typeof modelProviders.$inferSelect;
export type ProviderKind = (typeof providerKind.enumValues)[number];

/** A person's passkeys: the public half of each, to check sign-ins against. */
export const passkeys = pgTable(
  'passkeys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The credential's id, base64url, as the browser reports it. */
    credentialId: text('credential_id').notNull().unique(),
    publicKey: bytea('public_key').notNull(),
    counter: integer('counter').notNull().default(0),
    transports: text('transports').array().notNull().default([]),
    /** What they called it, or where it was made ("Chrome on Mac"). */
    label: text('label').notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [index('passkeys_user_idx').on(t.userId)],
);

/** Signed-in browsers. Only a hash of each token is kept. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/**
 * Personal access tokens, for agents (Claude, Cursor…) working with Corkboard through the agent API and MCP. Each acts
 * as its owner, with their access, limited to its scopes. Only a hash of each token is kept, and its first characters
 * for people to tell them apart.
 */
export const accessTokens = pgTable(
  'access_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** What its owner called it, and how the board names the agent: "Cursor", "Claude Code". */
    name: text('name').notNull(),
    /** The token's first characters, "cbp_AbCd1234", shown in the list. */
    prefix: text('prefix').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    scopes: text('scopes').array().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('access_tokens_user_idx').on(t.userId)],
);

export type AccessToken = typeof accessTokens.$inferSelect;

/** A sign-in or sign-up under way: the challenge the passkey must sign, used once, for a few minutes. */
export const authChallenges = pgTable('auth_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  challenge: text('challenge').notNull(),
  purpose: text('purpose', { enum: ['register', 'login', 'add'] }).notNull(),
  /** Who's adding a passkey, or (signing up) the id the new person will get. */
  userId: uuid('user_id').notNull(),
  name: text('name'),
  email: text('email'),
  /** What to call the passkey once it's made. */
  label: text('label'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export type Passkey = typeof passkeys.$inferSelect;

/**
 * Notes written during a hidden writing round: kept here, seen only by their author, until a facilitator reveals them
 * all onto the board at once (see WritingService). Never in the board's document before then.
 */
/** Where a hidden writing round is: open (taking notes), revealing (notes fixed, being put on the board) or closed. */
export const writingStatus = pgEnum('writing_status', ['open', 'revealing', 'closed']);

/**
 * Hidden writing rounds, kept in the database so taking a note and revealing them are one ordered story: a write
 * holds a share lock on its open round, and revealing takes the round out of `open` under an exclusive one, so every
 * note it reveals was written before it and none can be written after.
 */
export const writingRounds = pgTable(
  'writing_rounds',
  {
    id: uuid('id').primaryKey(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    status: writingStatus('status').notNull().default('open'),
    createdAt: createdAt(),
  },
  (t) => [index('writing_rounds_board_idx').on(t.boardId)],
);

/** Templates a workspace's people saved from their boards, for anyone in the workspace to start from. */
export const workspaceTemplates = pgTable(
  'workspace_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    category: text('category').notNull(),
    /** The board as a layout (boards/layout.ts), and its agenda if it had one. */
    layout: jsonb('layout').notNull(),
    agenda: jsonb('agenda'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('workspace_templates_org_idx').on(t.orgId)],
);

/** Planning poker estimates, kept here until the round is revealed so nobody sees anyone else's first. */
export const pokerEstimates = pgTable(
  'poker_estimates',
  {
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    /** The round it belongs to; estimates from an earlier round are cleared when a new one starts. */
    round: uuid('round').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    value: text('value').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.boardId, t.round, t.userId] })],
);

export const noteDrafts = pgTable(
  'note_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    /** The writing round it belongs to; drafts from an earlier round are cleared when a new one starts. */
    round: uuid('round').notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    color: text('color').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('note_drafts_board_round_idx').on(t.boardId, t.round)],
);

/** A workspace's connections to issue trackers (GitHub, Linear, Jira), to send board tasks to. */
export const integrations = pgTable('integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['github', 'linear', 'jira'] }).notNull(),
  label: text('label').notNull(),
  /** Where issues go: a repository, a team, a Jira site and project (see IntegrationConfig). */
  config: jsonb('config').$type<Record<string, string>>().notNull(),
  /** The access token, encrypted like model keys. */
  tokenEncrypted: text('token_encrypted').notNull(),
  /** Signs the tracker's webhooks (see webhooks.ts), encrypted like the token; null until an owner sets one up. */
  webhookSecretEncrypted: text('webhook_secret_encrypted'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  /** Keeping linked tasks in step (tracker-sync.service.ts): when it last worked, and why it last didn't. */
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  syncError: text('sync_error'),
  syncErrorAt: timestamp('sync_error_at', { withTimezone: true }),
  /** Failures in a row, for backing off; and when it's next due (each run claims it by moving this on). */
  syncFailures: integer('sync_failures').notNull().default(0),
  syncNextAt: timestamp('sync_next_at', { withTimezone: true }),
});

/**
 * A board task sent (or being sent) to an issue tracker. Claimed here before the tracker is called, one per task, so
 * two exports at once can't both make an issue. `pending` while the call is out; `done` with the issue; `unknown`
 * when the call failed without an answer, so it may or may not have made one.
 */
export const issueExports = pgTable(
  'issue_exports',
  {
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull(),
    integrationId: uuid('integration_id').references(() => integrations.id, { onDelete: 'set null' }),
    status: text('status', { enum: ['pending', 'done', 'unknown'] }).notNull(),
    kind: text('kind', { enum: ['github', 'linear', 'jira'] }).notNull(),
    issueKey: text('issue_key'),
    url: text('url'),
    createdAt: createdAt(),
    /** When the current send claimed it: a claim still pending long after is one a crash or restart left behind. */
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Where the task and its issue last agreed (see tracker-sync.ts SyncedState), so each side's changes since can be
     * told apart; and when they were last compared. Null for tasks sent before sync existed.
     */
    synced: jsonb('synced').$type<SyncedState>(),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.boardId, t.taskId] })],
);

/** Tokens each model call used: for a workspace's usage and spend. */
export const searchProvider = pgEnum('search_provider', ['brave', 'tavily']);

/** What a workspace's assistant may use beyond the board: web search, through a search service with the workspace's key. */
export const workspaceTools = pgTable('workspace_tools', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  webSearch: boolean('web_search').notNull().default(false),
  searchProvider: searchProvider('search_provider'),
  searchKeyEncrypted: text('search_key_encrypted'),
  /** The assistant may make mini-apps on the workspace's boards. */
  miniApps: boolean('mini_apps').notNull().default(true),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const modelUsage = pgTable(
  'model_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    /** The connection used; kept (null) when it's removed, so past spend still adds up. */
    providerId: uuid('provider_id').references(() => modelProviders.id, { onDelete: 'set null' }),
    providerLabel: text('provider_label').notNull(),
    boardId: uuid('board_id').references(() => boards.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** What it was for: assist, summary, recap, image. */
    feature: text('feature').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('model_usage_org_time_idx').on(t.orgId, t.createdAt)],
);

/** Who a workspace policy lets do something, on a board: its workspace's owners, the board's owners, anyone who can edit it, or anyone who can open it. */
export const policyWho = pgEnum('policy_who', ['workspace_owners', 'board_owners', 'editors', 'everyone']);

/** What a workspace's owners allow on its boards. No row: the defaults below, which are how Corkboard behaved before policies. */
export const workspacePolicies = pgTable('workspace_policies', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  /** Who may give people in the workspace a role on a board (never `everyone`). */
  shareWithPeople: policyWho('share_with_people').notNull().default('board_owners'),
  /** Who may make, change and turn off share links (never `everyone`). */
  shareLinks: policyWho('share_links').notNull().default('board_owners'),
  /** Share links may let guests edit. Off: existing editable links open read-only. */
  editableLinks: boolean('editable_links').notNull().default(true),
  /** Share links need a password. On: links without one stop opening. */
  linkPassword: boolean('link_password').notNull().default(false),
  /** Share links expire within this many days; null for no limit. */
  linkMaxDays: integer('link_max_days'),
  /** Who may export a board: image, PDF, Markdown, CSV, or tasks sent to a tracker. */
  exports: policyWho('exports').notNull().default('everyone'),
  /** Who may open a board for feedback from outside the workspace (never `everyone`); board owners includes the facilitator. */
  feedback: policyWho('feedback').notNull().default('board_owners'),
  /** Keep board history, saved versions and the assistant's undo list this many days; null keeps them for good. */
  retentionDays: integer('retention_days'),
  /** Boards can be embedded elsewhere, live and read-only, through share links. Off: embeds stop showing. */
  embeds: boolean('embeds').notNull().default(true),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A workspace's own logo pack for diagrams, made from a vendor's icon download (AWS, Azure, Google Cloud…) and kept as
 * plain, checked SVG drawings by name. Shapes show them as `logo:<pack>/<logo>`.
 */
export const logoPacks = pgTable(
  'logo_packs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    /** Lower case and hyphens: the `<pack>` in `logo:<pack>/<logo>`. */
    name: text('name').notNull(),
    /** Logo name → its viewBox and drawing. */
    logos: jsonb('logos').$type<Record<string, { vb: string; body: string }>>().notNull().default({}),
    /** The vendor's terms, as given with its download, kept with the pack. */
    licence: text('licence'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('logo_packs_org_name').on(t.orgId, t.name)],
);
export type LogoPack = typeof logoPacks.$inferSelect;

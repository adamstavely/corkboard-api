import { type AnyPgColumn, customType, integer, index, jsonb, pgEnum, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/** Raw bytes; Yjs state is stored as-is. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** People. There's no sign-in: whoever opens Corkboard picks who they are, or adds themselves. Email is stored lower-cased. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
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
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('org_invites_org_email').on(t.orgId, t.email), index('org_invites_email').on(t.email)],
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
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  opens: integer('opens').notNull().default(0),
  lastOpenedAt: timestamp('last_opened_at', { withTimezone: true }),
  createdAt: createdAt(),
});

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
    createdAt: createdAt(),
  },
  (t) => [index('board_events_board').on(t.boardId, t.createdAt)],
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
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

/** Tokens each model call used: for a workspace's usage and spend. */
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

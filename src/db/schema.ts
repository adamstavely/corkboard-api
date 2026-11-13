import { customType, integer, index, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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

export type User = typeof users.$inferSelect;
export type Org = typeof orgs.$inferSelect;
export type Board = typeof boards.$inferSelect;
export type OrgRole = (typeof orgRole.enumValues)[number];
export type BoardAccess = (typeof boardAccess.enumValues)[number];
export type OrgInvite = typeof orgInvites.$inferSelect;
export type ModelProvider = typeof modelProviders.$inferSelect;
export type ProviderKind = (typeof providerKind.enumValues)[number];

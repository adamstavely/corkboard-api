import { boolean, customType, index, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/** Raw bytes; Yjs state is stored as-is. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** People, keyed by their identity provider's subject. Name and email are refreshed from the token on each sign-in. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  oidcSubject: text('oidc_subject').notNull().unique(),
  email: text('email'),
  /** Set from the identity provider's email_verified claim on each sign-in. */
  emailVerified: boolean('email_verified').notNull().default(false),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

/** Admins configure the org's model providers; members use them. */
export const orgRole = pgEnum('org_role', ['admin', 'member']);

export const orgMembers = pgTable(
  'org_members',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: orgRole('role').notNull().default('member'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

/**
 * Someone asked to join a workspace, by email. They see it once they sign in with that email, verified by the identity
 * provider, and accept or decline it there. One open invite per email per workspace.
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
    role: orgRole('role').notNull().default('member'),
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

/** A board's content: the Yjs document, encoded as one update. Kept apart from `boards` so listing stays light. */
export const boardDocuments = pgTable('board_documents', {
  boardId: uuid('board_id')
    .primaryKey()
    .references(() => boards.id, { onDelete: 'cascade' }),
  state: bytea('state').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Org = typeof orgs.$inferSelect;
export type Board = typeof boards.$inferSelect;
export type OrgRole = (typeof orgRole.enumValues)[number];
export type OrgInvite = typeof orgInvites.$inferSelect;
export type ModelProvider = typeof modelProviders.$inferSelect;
export type ProviderKind = (typeof providerKind.enumValues)[number];

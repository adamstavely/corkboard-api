import { customType, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Raw bytes; Yjs state is stored as-is. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** People, keyed by their identity provider's subject. Name and email are refreshed from the token on each sign-in. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  oidcSubject: text('oidc_subject').notNull().unique(),
  email: text('email'),
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

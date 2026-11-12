import { PostgreSqlContainer } from '@testcontainers/postgresql';

/** One Postgres for the whole integration run; each suite's app migrates it on start. */
export default async function globalSetup(): Promise<void> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  (globalThis as { __PG_CONTAINER__?: unknown }).__PG_CONTAINER__ = container;
}

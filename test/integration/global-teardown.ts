import type { StartedTestContainer } from 'testcontainers';

export default async function globalTeardown(): Promise<void> {
  await (globalThis as { __PG_CONTAINER__?: StartedTestContainer }).__PG_CONTAINER__?.stop();
}

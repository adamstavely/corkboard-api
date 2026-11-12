import type { StartedTestContainer } from 'testcontainers';

export default async function globalTeardown(): Promise<void> {
  const containers = (globalThis as { __CONTAINERS__?: StartedTestContainer[] }).__CONTAINERS__ ?? [];
  await Promise.all(containers.map((c) => c.stop()));
}

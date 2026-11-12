import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait } from 'testcontainers';

/** One Postgres and one Elasticsearch for the whole integration run; each suite's app migrates Postgres on start. */
export default async function globalSetup(): Promise<void> {
  const [pg, es] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine').start(),
    new GenericContainer('docker.elastic.co/elasticsearch/elasticsearch:8.19.2')
      .withEnvironment({
        'discovery.type': 'single-node',
        'xpack.security.enabled': 'false',
        ES_JAVA_OPTS: '-Xms512m -Xmx512m',
      })
      .withExposedPorts(9200)
      .withWaitStrategy(Wait.forHttp('/_cluster/health?wait_for_status=yellow', 9200).forStatusCode(200))
      .withStartupTimeout(180_000)
      .start(),
  ]);
  process.env.DATABASE_URL = pg.getConnectionUri();
  process.env.ES_NODE = `http://${es.getHost()}:${es.getMappedPort(9200)}`;
  (globalThis as { __CONTAINERS__?: unknown }).__CONTAINERS__ = [pg, es];
}

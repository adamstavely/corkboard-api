export interface AppConfig {
  port: number;
  databaseUrl: string;
  /** Apply pending migrations when the app starts. On by default; turn off where a deploy job runs them instead. */
  migrateOnStart: boolean;
  /** Elasticsearch, for searching boards. Local dev: the docker-compose node. */
  elasticsearchNode: string;
  /** 32 bytes, base64: encrypts the API keys of workspaces' model connections. Without it, keys can't be saved. */
  modelKeySecret: string | undefined;
}

export default (): AppConfig => ({
  port: Number(process.env.PORT ?? 3700),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://corkboard:corkboard@localhost:5440/corkboard',
  migrateOnStart: process.env.MIGRATE_ON_START !== 'false',
  elasticsearchNode: process.env.ES_NODE ?? 'http://localhost:9210',
  modelKeySecret: process.env.MODEL_KEY_SECRET?.trim() || undefined,
});

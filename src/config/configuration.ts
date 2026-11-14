export interface AppConfig {
  port: number;
  databaseUrl: string;
  /** Apply pending migrations when the app starts. On by default; turn off where a deploy job runs them instead. */
  migrateOnStart: boolean;
  /** Elasticsearch, for searching boards. Local dev: the docker-compose node. */
  elasticsearchNode: string;
  /** 32 bytes, base64: encrypts the API keys of workspaces' model connections. Without it, keys can't be saved. */
  modelKeySecret: string | undefined;
  /**
   * Let people pick who they are from a list, with no sign-in (PEOPLE_PICKER). For local development only; on unless
   * NODE_ENV is production. Passkey sign-in works either way.
   */
  peoplePicker: boolean;
  /** Passkeys: the site they belong to (the UI's host name) and the origins sign-ins may come from. */
  webauthn: { rpId: string; rpName: string; origins: string[] };
}

export default (): AppConfig => ({
  port: Number(process.env.PORT ?? 3700),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://corkboard:corkboard@localhost:5440/corkboard',
  migrateOnStart: process.env.MIGRATE_ON_START !== 'false',
  elasticsearchNode: process.env.ES_NODE ?? 'http://localhost:9210',
  modelKeySecret: process.env.MODEL_KEY_SECRET?.trim() || undefined,
  peoplePicker: process.env.PEOPLE_PICKER ? process.env.PEOPLE_PICKER === 'true' : process.env.NODE_ENV !== 'production',
  webauthn: {
    rpId: process.env.WEBAUTHN_RP_ID ?? 'localhost',
    rpName: 'Corkboard',
    origins: (process.env.WEBAUTHN_ORIGINS ?? 'http://localhost:4300').split(',').map((o) => o.trim()).filter(Boolean),
  },
});

import { Global, Inject, Injectable, Logger, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { join } from 'node:path';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

export const DB = Symbol('DB');
const POOL = Symbol('POOL');

/** The SQL migrations drizzle-kit generates; they ship next to dist/ in the image. */
export const MIGRATIONS_FOLDER = join(__dirname, '..', '..', 'drizzle');

export const InjectDb = () => Inject(DB);

@Injectable()
class DbLifecycle implements OnModuleInit, OnApplicationShutdown {
  readonly #log = new Logger('Db');

  constructor(
    @Inject(POOL) private readonly pool: Pool,
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.get<boolean>('migrateOnStart')) return;
    await migrate(this.db, { migrationsFolder: MIGRATIONS_FOLDER });
    this.#log.log('Migrations applied');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new Pool({ connectionString: config.getOrThrow<string>('databaseUrl') }),
    },
    { provide: DB, inject: [POOL], useFactory: (pool: Pool): Db => drizzle(pool, { schema }) },
    DbLifecycle,
  ],
  exports: [DB],
})
export class DbModule {}

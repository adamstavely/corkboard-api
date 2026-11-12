import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { join } from 'node:path';
import { Pool } from 'pg';

/** Applies pending migrations, for deploys that run them as a job (MIGRATE_ON_START=false). */
async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://corkboard:corkboard@localhost:5440/corkboard',
  });
  await migrate(drizzle(pool), { migrationsFolder: join(__dirname, '..', 'drizzle') });
  await pool.end();
  console.log('Migrations applied');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

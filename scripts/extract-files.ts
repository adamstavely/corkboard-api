import { NestFactory } from '@nestjs/core';
import { eq, isNull } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import { DB, type Db } from '../src/db/db.module';
import { boardFiles, boardFileTexts, boards } from '../src/db/schema';
import { READABLE } from '../src/files/extract';
import { FilesService } from '../src/files/files.service';
import { SearchIndex } from '../src/search/search-index';

/** Reads the text of every file uploaded before file search, so the assistant can search those too. */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const db = app.get<Db>(DB);
  const files = app.get(FilesService);
  await app.get(SearchIndex).ensureIndex();
  const rows = await db
    .select({ id: boardFiles.id, boardId: boardFiles.boardId, orgId: boards.orgId, name: boardFiles.name, mime: boardFiles.mime })
    .from(boardFiles)
    .innerJoin(boards, eq(boards.id, boardFiles.boardId))
    .leftJoin(boardFileTexts, eq(boardFileTexts.fileId, boardFiles.id))
    .where(isNull(boardFileTexts.fileId));
  let read = 0;
  for (const f of rows.filter((r) => READABLE.has(r.mime))) {
    const [{ data }] = await db.select({ data: boardFiles.data }).from(boardFiles).where(eq(boardFiles.id, f.id));
    if (await files.readText({ boardId: f.boardId, orgId: f.orgId }, f, data)) read++;
  }
  await app.close();
  console.log(`Read ${read} of ${rows.length} files not read before`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

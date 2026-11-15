import { NestFactory } from '@nestjs/core';
import * as Y from 'yjs';
import { AppModule } from '../src/app.module';
import { boardText } from '../src/boards/board-text';
import { DB, type Db } from '../src/db/db.module';
import { boardDocuments, boardFiles, boardFileTexts, boards } from '../src/db/schema';
import { chunks } from '../src/files/extract';
import { SearchIndex } from '../src/search/search-index';
import { eq } from 'drizzle-orm';

/** Rebuilds the search indices from Postgres: every board's title and the text of its notes, and its files' text. */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const db = app.get<Db>(DB);
  const search = app.get(SearchIndex);
  await search.ensureIndex();
  const rows = await db.select({ board: boards, state: boardDocuments.state }).from(boards).leftJoin(boardDocuments, eq(boardDocuments.boardId, boards.id));
  for (const { board, state } of rows) {
    const doc = new Y.Doc();
    if (state?.length) Y.applyUpdate(doc, state);
    await search.indexNotes(board, boardText(doc));
    doc.destroy();
  }
  const texts = await db
    .select({ fileId: boardFileTexts.fileId, boardId: boardFileTexts.boardId, orgId: boards.orgId, fileName: boardFiles.name, text: boardFileTexts.text })
    .from(boardFileTexts)
    .innerJoin(boardFiles, eq(boardFiles.id, boardFileTexts.fileId))
    .innerJoin(boards, eq(boards.id, boardFileTexts.boardId));
  for (const { text, ...file } of texts) await search.indexFileChunks(file, chunks(text));
  await app.close();
  console.log(`Reindexed ${rows.length} boards and ${texts.length} files`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { NestFactory } from '@nestjs/core';
import * as Y from 'yjs';
import { AppModule } from '../src/app.module';
import { boardText } from '../src/boards/board-text';
import { DB, type Db } from '../src/db/db.module';
import { boardDocuments, boards } from '../src/db/schema';
import { SearchIndex } from '../src/search/search-index';
import { eq } from 'drizzle-orm';

/** Rebuilds the search index from Postgres: every board's title and the text of its notes. */
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
  await app.close();
  console.log(`Reindexed ${rows.length} boards`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

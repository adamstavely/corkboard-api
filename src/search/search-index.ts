import { Client, errors } from '@elastic/elasticsearch';
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Board } from '../db/schema';
import type { NoteText } from '../boards/board-text';

export const BOARDS_INDEX = 'corkboard-boards';

/** One board as search sees it: its title and the plain text of each note. */
interface BoardSearchDoc {
  boardId: string;
  orgId: string;
  title: string;
  notes: string[];
  updatedAt: string;
}

export interface SearchHit {
  boardId: string;
  title: string;
  updatedAt: string;
  /** Matching passages, with matches wrapped in <mark>. */
  snippets: string[];
}

/**
 * Board titles and note text in Elasticsearch, for finding boards by what's on them. Postgres stays the source of
 * truth: a failed write here is logged and the next save of the board puts it right.
 */
@Injectable()
export class SearchIndex implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly #log = new Logger('SearchIndex');
  readonly #es: Client;

  constructor(config: ConfigService) {
    this.#es = new Client({ node: config.getOrThrow<string>('elasticsearchNode'), requestTimeout: 10_000, maxRetries: 1 });
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.ensureIndex();
    } catch (err) {
      this.#log.warn(`Search is unavailable until Elasticsearch answers: ${String(err)}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.#es.close();
  }

  async ensureIndex(): Promise<void> {
    if (await this.#es.indices.exists({ index: BOARDS_INDEX })) return;
    try {
      await this.#es.indices.create({
        index: BOARDS_INDEX,
        mappings: {
          dynamic: 'strict',
          properties: {
            boardId: { type: 'keyword' },
            orgId: { type: 'keyword' },
            title: { type: 'text' },
            notes: { type: 'text' },
            updatedAt: { type: 'date' },
          },
        },
      });
    } catch (err) {
      // Another instance made it first.
      const type = err instanceof errors.ResponseError ? (err.body as { error?: { type?: string } }).error?.type : undefined;
      if (type !== 'resource_already_exists_exception') throw err;
    }
  }

  /** Records a board's title (on create and rename); its notes are left as they were. */
  async indexBoard(board: Board): Promise<void> {
    await this.#quietly(`index board ${board.id}`, () =>
      this.#es.update<BoardSearchDoc, Partial<BoardSearchDoc>>({
        index: BOARDS_INDEX,
        id: board.id,
        doc: { title: board.title, updatedAt: board.updatedAt.toISOString() },
        upsert: this.#doc(board, []),
      }),
    );
  }

  /** Records what a board's notes say, after each save of its document. */
  async indexNotes(board: Board, notes: NoteText[]): Promise<void> {
    await this.#quietly(`index notes of ${board.id}`, () =>
      this.#es.index<BoardSearchDoc>({ index: BOARDS_INDEX, id: board.id, document: this.#doc(board, notes) }),
    );
  }

  async removeBoard(boardId: string): Promise<void> {
    await this.#quietly(`remove board ${boardId}`, () =>
      this.#es.delete({ index: BOARDS_INDEX, id: boardId }, { ignore: [404] }),
    );
  }

  /** Boards in a workspace whose title or notes match, best first. */
  async search(orgId: string, query: string, size = 20): Promise<SearchHit[]> {
    const res = await this.#es.search<BoardSearchDoc>({
      index: BOARDS_INDEX,
      size,
      query: {
        bool: {
          filter: [{ term: { orgId } }],
          must: [{ multi_match: { query, fields: ['title^2', 'notes'], fuzziness: 'AUTO', operator: 'and' } }],
        },
      },
      highlight: {
        pre_tags: ['<mark>'],
        post_tags: ['</mark>'],
        encoder: 'html',
        fields: { notes: { number_of_fragments: 3, fragment_size: 120 }, title: { number_of_fragments: 0 } },
      },
    });
    return res.hits.hits.map((hit) => ({
      boardId: hit._source!.boardId,
      title: hit._source!.title,
      updatedAt: hit._source!.updatedAt,
      snippets: hit.highlight?.['notes'] ?? [],
    }));
  }

  /** Makes writes visible to search straight away; for tests. */
  async refresh(): Promise<void> {
    await this.#es.indices.refresh({ index: BOARDS_INDEX });
  }

  #doc(board: Board, notes: NoteText[]): BoardSearchDoc {
    return {
      boardId: board.id,
      orgId: board.orgId,
      title: board.title,
      notes: notes.map((n) => n.text),
      updatedAt: board.updatedAt.toISOString(),
    };
  }

  async #quietly(what: string, write: () => Promise<unknown>): Promise<void> {
    try {
      await write();
    } catch (err) {
      this.#log.warn(`Couldn't ${what}: ${String(err)}`);
    }
  }
}

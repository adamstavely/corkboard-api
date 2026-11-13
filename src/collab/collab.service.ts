import { Database } from '@hocuspocus/extension-database';
import { Hocuspocus } from '@hocuspocus/server';
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { IncomingHttpHeaders, IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import * as Y from 'yjs';
import { UsersService } from '../auth/users.service';
import { boardText } from '../boards/board-text';
import { BoardsService } from '../boards/boards.service';
import { atLeast, type Role } from '../access/roles';
import type { User } from '../db/schema';
import { SearchIndex } from '../search/search-index';

/** Where clients connect: wss://…/collab (the UI reaches it as /api/collab). */
export const COLLAB_PATH = '/collab';

/** How often to ping each socket; Hocuspocus drops a connection it hasn't heard from within its timeout (30s). */
const PING_MS = 10_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CollabContext {
  user: User;
  /** Their role on the board; readers and commenters connect read-only. Unset for the server's own edits. */
  role?: Role;
}

function toHeaders(raw: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) headers.append(key, v);
  }
  return headers;
}

/**
 * Real-time sync: each board is a Yjs document that Hocuspocus shares between everyone who has it open, loaded from
 * and saved to Postgres, and indexed for search after each save. Runs on the API's own HTTP server.
 */
@Injectable()
export class CollabService implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly #log = new Logger('Collab');
  readonly #wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  readonly hocuspocus: Hocuspocus<CollabContext>;
  #server: Server | undefined;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly users: UsersService,
    private readonly boards: BoardsService,
    private readonly search: SearchIndex,
  ) {
    this.hocuspocus = new Hocuspocus<CollabContext>({
      name: 'corkboard',
      quiet: true,
      // Save two seconds after the last change, and at least every ten while people keep editing.
      debounce: 2000,
      maxDebounce: 10_000,
      onAuthenticate: async ({ token, documentName, connectionConfig }): Promise<CollabContext> => {
        if (!UUID.test(documentName)) throw new Error('Board not found');
        let user: User;
        try {
          user = await this.users.byToken(token);
        } catch {
          throw new Error('Pick who you are first');
        }
        const { role } = await this.boards.access(user, documentName);
        // Their edits are refused here, whatever the client does; they still see everyone else's, and share presence.
        connectionConfig.readOnly = !atLeast(role, 'updater');
        return { user, role };
      },
      extensions: [
        new Database({
          fetch: async ({ documentName }) => {
            const state = await this.boards.loadState(documentName);
            return state && state.length > 0 ? new Uint8Array(state) : null;
          },
          store: async ({ documentName, state, document }) => {
            const board = await this.boards.storeState(documentName, state);
            // A board deleted while open has nothing left to save or index.
            if (board) await this.search.indexNotes(board, boardText(document));
          },
        }),
      ],
    });
  }

  onApplicationBootstrap(): void {
    // Scripts run the app without an HTTP server (see scripts/reindex.ts); there's nothing to serve then.
    if (!this.adapterHost.httpAdapter) return;
    this.#server = this.adapterHost.httpAdapter.getHttpServer() as Server;
    this.#server.on('upgrade', this.#onUpgrade);
  }

  async onApplicationShutdown(): Promise<void> {
    this.#server?.off('upgrade', this.#onUpgrade);
    // Save every open board now, rather than trusting a debounced store to land before the database closes.
    await Promise.all(
      [...this.hocuspocus.documents.values()].map((doc) =>
        this.boards.storeState(doc.name, Buffer.from(Y.encodeStateAsUpdate(doc))).catch((err: unknown) =>
          this.#log.error(`Couldn't save board ${doc.name} on shutdown: ${String(err)}`),
        ),
      ),
    );
    this.hocuspocus.closeConnections();
    this.#wss.close();
  }

  /**
   * Disconnects one person from these boards (or all their boards), e.g. when their role changes. Their client
   * reconnects and is let back in with the new role, or turned away.
   */
  disconnect(userId: string, boardIds?: readonly string[]): void {
    for (const [name, document] of this.hocuspocus.documents) {
      if (boardIds && !boardIds.includes(name)) continue;
      for (const connection of document.connections.keys()) {
        if ((connection.context as CollabContext | undefined)?.user?.id === userId) connection.close();
      }
    }
  }

  /** Disconnects everyone from a board, e.g. once it's deleted. */
  closeBoard(boardId: string): void {
    this.hocuspocus.closeConnections(boardId);
  }

  readonly #onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== COLLAB_PATH && !path.startsWith(`${COLLAB_PATH}/`)) {
      socket.destroy();
      return;
    }
    this.#wss.handleUpgrade(req, socket, head, (ws) => this.#connect(ws, req));
  };

  #connect(ws: WebSocket, req: IncomingMessage): void {
    const request = new Request(new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`), {
      headers: toHeaders(req.headers),
    });
    const connection = this.hocuspocus.handleConnection(ws, request);
    const ping = setInterval(() => ws.ping(), PING_MS);
    ws.on('pong', () => connection.touch());
    ws.on('message', (data: Buffer) => connection.handleMessage(new Uint8Array(data)));
    ws.on('close', (code, reason) => {
      clearInterval(ping);
      connection.handleClose({ code, reason: reason.toString() });
    });
    ws.on('error', (err) => this.#log.warn(`Socket error: ${err.message}`));
  }
}

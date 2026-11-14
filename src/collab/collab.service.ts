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
import { isLive, LinksService } from '../links/links.service';
import { serverOwnedIn } from './server-owned';

/** Who someone viewing through a share link is: nobody in particular. */
const GUEST: User = { id: '00000000-0000-0000-0000-000000000000', name: 'Guest', email: 'guest@corkboard.invalid', createdAt: new Date(0) };
/** Share-link viewers connect with this before the link's token. */
const LINK = 'link:';

/** Where clients connect: wss://…/collab (the UI reaches it as /api/collab). */
export const COLLAB_PATH = '/collab';

/** How often to ping each socket; Hocuspocus drops a connection it hasn't heard from within its timeout (30s). */
const PING_MS = 10_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CollabContext {
  user: User;
  /** Their role on the board; readers and commenters connect read-only. Unset for the server's own edits. */
  role?: Role;
  /** The share link they came through, for a guest. */
  linkId?: string;
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
  /** For each share link someone has opened, when its viewers are let go. */
  readonly #expiries = new Map<string, NodeJS.Timeout>();
  /** Connections made read-only for the one message being refused. */
  readonly #refusing = new WeakSet<object>();

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly users: UsersService,
    private readonly boards: BoardsService,
    private readonly search: SearchIndex,
    private readonly links: LinksService,
  ) {
    this.hocuspocus = new Hocuspocus<CollabContext>({
      name: 'corkboard',
      quiet: true,
      // Save two seconds after the last change, and at least every ten while people keep editing.
      debounce: 2000,
      maxDebounce: 10_000,
      onAuthenticate: async ({ token, documentName, connectionConfig }): Promise<CollabContext> => {
        if (!UUID.test(documentName)) throw new Error('Board not found');
        // Someone with a share link: read-only, as a guest, on that link's board only.
        if (token.startsWith(LINK)) {
          const link = await this.links.byToken(token.slice(LINK.length));
          if (!link || link.boardId !== documentName) throw new Error('This link has been turned off or has expired');
          connectionConfig.readOnly = true;
          this.watchLink(link.id, link.expiresAt?.getTime() ?? null);
          return { user: GUEST, role: 'reader', linkId: link.id };
        }
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
      // A client's update that would change chat, votes or anything else only the API writes is refused, the way a
      // read-only client's edits are: that message isn't applied. Yjs applies each client's changes in order, so its
      // later edits wait on the refused one and it falls out of sync until it reloads; well-behaved clients never write
      // these parts.
      beforeSync: ({ type, payload, connection, document, documentName, context }) => {
        if ((type !== 1 && type !== 2) || connection.readOnly) return Promise.resolve();
        const owned = serverOwnedIn(document, payload);
        if (!owned) return Promise.resolve();
        this.#log.warn(`Refused ${context.user.id}'s change to "${owned}" on board ${documentName}`);
        connection.readOnly = true;
        this.#refusing.add(connection);
        return Promise.resolve();
      },
      afterHandleMessage: ({ connection }) => {
        if (this.#refusing.delete(connection)) connection.readOnly = false;
        return Promise.resolve();
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
    for (const timer of this.#expiries.values()) clearTimeout(timer);
    this.#expiries.clear();
    this.hocuspocus.closeConnections();
    this.#wss.close();
  }

  /**
   * Disconnects one person from these boards (or all their boards), e.g. when their role changes. Their client
   * reconnects and is let back in with the new role, or turned away.
   */
  /** Lets go of everyone viewing through a share link that's been turned off. */
  disconnectLink(linkId: string): void {
    for (const [, document] of this.hocuspocus.documents) {
      for (const connection of document.connections.keys()) {
        if ((connection.context as CollabContext | undefined)?.linkId === linkId) connection.close();
      }
    }
  }

  /**
   * Lets a share link's viewers go when it expires (now, if it already has), replacing any earlier deadline. Checked
   * against the database when the time comes, in case the link was changed meanwhile.
   */
  watchLink(linkId: string, expiresAt: number | null): void {
    clearTimeout(this.#expiries.get(linkId));
    this.#expiries.delete(linkId);
    if (expiresAt === null) return;
    // Timers can't wait longer than about 24 days; a later deadline is checked again then.
    const wait = Math.min(Math.max(0, expiresAt - Date.now()), 2 ** 31 - 1);
    const timer = setTimeout(() => {
      this.#expiries.delete(linkId);
      void this.links.byId(linkId).then(
        (link) => {
          if (!link || !isLive(link)) this.disconnectLink(linkId);
          else this.watchLink(linkId, link.expiresAt?.getTime() ?? null);
        },
        (err: unknown) => this.#log.warn(`Couldn't check share link ${linkId}: ${String(err)}`),
      );
    }, wait);
    timer.unref();
    this.#expiries.set(linkId, timer);
  }

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

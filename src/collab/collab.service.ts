import { Database } from '@hocuspocus/extension-database';
import { Hocuspocus } from '@hocuspocus/server';
import { HttpException, Injectable, Logger, OnApplicationBootstrap, BeforeApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { IncomingHttpHeaders, IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { Subject } from 'rxjs';
import { WebSocketServer, type WebSocket } from 'ws';
import * as Y from 'yjs';
import { UsersService, type Signin } from '../auth/users.service';
import { boardText } from '../boards/board-text';
import { BoardsService } from '../boards/boards.service';
import { atLeast, type Role } from '../access/roles';
import type { User } from '../db/schema';
import { SearchIndex } from '../search/search-index';
import { isLive, LinksService } from '../links/links.service';
import { rootProblem } from './root-schema';
import { serverOwnedIn } from './server-owned';
import { nodeProblem } from './node-schema';
import { canChangeLocked, lockProblem } from './locks';
import { project } from './projection';
import { describe as describeEdits, touchedBy, touched, type Touched } from './edit-log';
import { ActivityService } from '../activity/activity.service';
import { ParticipantsStore } from '../feedback/participants.store';

/** Who someone viewing through a share link is: nobody in particular. */
const GUEST: User = { id: '00000000-0000-0000-0000-000000000000', name: 'Guest', email: 'guest@corkboard.invalid', assistantAsksFirst: false, createdAt: new Date(0) };
/** The server itself, keeping a board loaded while its projections are open. */
export const SERVER: User = { id: '00000000-0000-0000-0000-000000000001', name: 'Corkboard', email: 'server@corkboard.invalid', assistantAsksFirst: false, createdAt: new Date(0) };
/** Share-link viewers connect with this before the link's token. */
const LINK = 'link:';
/** An embedded board (Notion, Confluence) connects with this before its link's token. */
const EMBED = 'embed:';

/** Where clients connect: wss://…/collab (the UI reaches it as /api/collab). */
export const COLLAB_PATH = '/collab';

/** How often to ping each socket; Hocuspocus drops a connection it hasn't heard from within its timeout (30s). */
const PING_MS = 10_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A participant's projection of a board (see projection.ts): "<boardId>~p~<userId>". Read-only, built here, never saved. */
const PROJECTION = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})~p~([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export const projectionName = (boardId: string, userId: string) => `${boardId}~p~${userId}`;
/** How long after a change to a board its projections catch up. */
const PROJECT_MS = 200;
/** People's edits made straight in a board are summed up in its history this often, a line per person. */
const EDIT_LOG_MS = 30_000;

interface CollabContext {
  user: User;
  /** Their role on the board; readers and commenters connect read-only. Unset for the server's own edits. */
  role?: Role;
  /** The share link they came through, for a guest. */
  linkId?: string;
  /** The sign-in session they came with (its token's hash), and when it runs out. */
  session?: { hash: string; expiresAt: number };
  /** A participant on their projection of this board. */
  projectionOf?: string;
  /** An embed's viewer: the board's workspace, so turning embeds off there lets them go. */
  embedIn?: string;
}

/** How often live connections' sessions are checked against the database, and how stale a writer's check may be. */
const SWEEP_MS = 30_000;
const WRITE_CHECK_MS = 15_000;

/** Closes a connection whose sign-in has ended; the client sees it signed out. */
const signedOutError = () => Object.assign(new Error('Signed out'), { code: 4401, reason: 'Signed out' });

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
export class CollabService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  readonly #log = new Logger('Collab');
  readonly #wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  readonly hocuspocus: Hocuspocus<CollabContext>;
  #server: Server | undefined;
  /** For each share link someone has opened, when its viewers are let go. */
  readonly #expiries = new Map<string, NodeJS.Timeout>();
  /** Connections made read-only for the one message being refused. */
  readonly #refusing = new WeakSet<object>();
  /** When each writer's session was last confirmed. */
  readonly #checked = new WeakMap<object, number>();
  #sweep: NodeJS.Timeout | undefined;
  #signedOut: { unsubscribe(): void } | undefined;
  /** For each board with projections open: a connection keeping the board loaded, and a pending catch-up. */
  readonly #projected = new Map<string, { hold: Promise<{ disconnect(): Promise<void> }>; timer?: NodeJS.Timeout }>();
  /** Boards someone just changed tasks on, over the socket: their linked issues follow (tracker-sync.service.ts). */
  readonly tasksEdited = new Subject<string>();
  /** Edits not yet in the history: per board and person, what they touched. */
  readonly #edits = new Map<string, { boardId: string; user: User; touched: Touched; timer: NodeJS.Timeout }>();

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly users: UsersService,
    private readonly boards: BoardsService,
    private readonly search: SearchIndex,
    private readonly links: LinksService,
    private readonly participants: ParticipantsStore,
    private readonly activity: ActivityService,
  ) {
    this.hocuspocus = new Hocuspocus<CollabContext>({
      name: 'corkboard',
      quiet: true,
      // Save two seconds after the last change, and at least every ten while people keep editing.
      debounce: 2000,
      maxDebounce: 10_000,
      onAuthenticate: async ({ token, documentName, connectionConfig }): Promise<CollabContext> => {
        // A participant from outside the team, on their projection of the board: signed in, and only their own.
        const projection = PROJECTION.exec(documentName);
        if (projection) {
          const [, boardId, userId] = projection;
          if (token.startsWith(LINK) || token.startsWith(EMBED)) throw new Error('Board not found');
          let signin: Signin;
          try {
            signin = await this.users.signin(token);
          } catch {
            throw new Error('Sign in first');
          }
          if (signin.user.id !== userId || !(await this.participants.active(boardId, userId))) throw new Error('Board not found');
          connectionConfig.readOnly = true;
          return { user: signin.user, role: 'reader', session: signin.session, projectionOf: boardId };
        }
        if (!UUID.test(documentName)) throw new Error('Board not found');
        // Someone with a share link: as a guest, on that link's board only, read-only unless the link lets them edit.
        // An embed: through its link, always read-only, while the workspace allows embeds.
        if (token.startsWith(EMBED)) {
          const { link, orgId } = await this.links.admitEmbed(token.slice(EMBED.length)).catch((err: unknown) => {
            throw new Error(err instanceof HttpException ? err.message : 'This link has been turned off or has expired');
          });
          if (link.boardId !== documentName) throw new Error('This link has been turned off or has expired');
          connectionConfig.readOnly = true;
          this.watchLink(link.id, link.expiresAt?.getTime() ?? null);
          return { user: GUEST, role: 'reader', linkId: link.id, embedIn: orgId };
        }
        // "link:<token>", or "link:<token>:<pass>" for a link with a password.
        if (token.startsWith(LINK)) {
          const [linkToken, pass] = token.slice(LINK.length).split(':');
          const admitted = await this.links.admit(linkToken, pass).catch((err: unknown) => {
            throw new Error(err instanceof HttpException ? err.message : 'This link has been turned off or has expired');
          });
          const { link, canEdit } = admitted;
          if (link.boardId !== documentName) throw new Error('This link has been turned off or has expired');
          // An editable link's guests change the board like updaters; chat, votes and the rest stay the API's.
          connectionConfig.readOnly = !canEdit;
          this.watchLink(link.id, link.expiresAt?.getTime() ?? null);
          return { user: GUEST, role: canEdit ? 'updater' : 'reader', linkId: link.id };
        }
        let signin: Signin;
        try {
          signin = await this.users.signin(token);
        } catch {
          throw new Error('Sign in first');
        }
        const { user, session } = signin;
        const { role } = await this.boards.access(user, documentName);
        // Their edits are refused here, whatever the client does; they still see everyone else's, and share presence.
        connectionConfig.readOnly = !atLeast(role, 'updater');
        return { user, role, session };
      },
      // A signed-out or expired session can't write: checked before each message, against the database at most every
      // few seconds. The sweep (below) closes idle ones too, so they stop reading as well.
      beforeHandleMessage: async ({ connection, context }) => {
        const session = context.session;
        if (!session) return;
        const now = Date.now();
        if (now >= session.expiresAt) throw signedOutError();
        if (now - (this.#checked.get(connection) ?? 0) < WRITE_CHECK_MS) return;
        if (!(await this.users.liveSessions([session.hash])).has(session.hash)) throw signedOutError();
        this.#checked.set(connection, now);
      },
      // A client's update that would change chat, votes or anything else only the API writes, that depends on something
      // the server doesn't have, that writes a malformed node, task or counter (or a part of the document no board has), or that changes something locked (unless they're an owner
      // or the facilitator), is refused the way a read-only client's edits are:
      // that message isn't applied. Yjs applies each client's changes in order, so its later edits wait on the refused one
      // and it falls out of sync until it reloads; well-behaved clients never write these.
      beforeSync: ({ type, payload, connection, document, documentName, context }) => {
        if ((type !== 1 && type !== 2) || connection.readOnly) return Promise.resolve();
        const refused =
          serverOwnedIn(document, payload) ??
          nodeProblem(document, payload) ??
          rootProblem(document, payload) ??
          // Guests (share links) are never the owner or the facilitator.
          (context.linkId || !canChangeLocked(document, context.role ?? 'reader', context.user.id) ? lockProblem(document, payload) : null);
        if (!refused) return Promise.resolve();
        this.#log.warn(`Refused ${context.user.id}'s change on board ${documentName}: ${refused}`);
        connection.readOnly = true;
        this.#refusing.add(connection);
        return Promise.resolve();
      },
      afterHandleMessage: ({ connection }) => {
        if (this.#refusing.delete(connection)) connection.readOnly = false;
        return Promise.resolve();
      },
      afterLoadDocument: async ({ documentName, document }) => {
        const projection = PROJECTION.exec(documentName);
        if (!projection) return;
        const boardId = projection[1];
        // The board stays loaded while anyone has a projection of it open, so its changes reach them.
        if (!this.#projected.has(boardId)) this.#projected.set(boardId, { hold: this.hocuspocus.openDirectConnection(boardId, { user: SERVER }) });
        await this.#projected.get(boardId)!.hold;
        // This one isn't among the open documents yet: fill it now.
        await this.#project(boardId, [[documentName, document]]);
      },
      onChange: ({ documentName, document, update, connection, context }) => {
        if (this.#projected.has(documentName)) this.refreshProjections(documentName);
        // Someone's own edit, from their board (the API's edits record themselves).
        const user = (context as CollabContext | undefined)?.user;
        if (connection && user && !(context).linkId && UUID.test(documentName)) this.#logEdit(documentName, user, document, update);
        if (connection && UUID.test(documentName) && document.getMap('tasks').size) this.tasksEdited.next(documentName);
        return Promise.resolve();
      },
      afterUnloadDocument: async ({ documentName }) => {
        const projection = PROJECTION.exec(documentName);
        if (!projection) return;
        const boardId = projection[1];
        const stillOpen = [...this.hocuspocus.documents.keys()].some((name) => PROJECTION.exec(name)?.[1] === boardId);
        const projected = this.#projected.get(boardId);
        if (stillOpen || !projected) return;
        this.#projected.delete(boardId);
        clearTimeout(projected.timer);
        await (await projected.hold).disconnect();
      },
      extensions: [
        new Database({
          fetch: async ({ documentName }) => {
            // Projections are built from their board, never loaded or saved.
            if (PROJECTION.test(documentName)) return null;
            const state = await this.boards.loadState(documentName);
            return state && state.length > 0 ? new Uint8Array(state) : null;
          },
          store: async ({ documentName, state, document }) => {
            if (PROJECTION.test(documentName)) return;
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
    // Signing out here closes that session's connections at once; the sweep catches sign-outs made on another API
    // instance, and sessions that expire, within SWEEP_MS.
    this.#signedOut = this.users.signedOut.subscribe((hash) => this.#closeSessions(new Set([hash])));
    this.#sweep = setInterval(() => void this.sweepSessions(), SWEEP_MS);
    this.#sweep.unref();
  }

  /** Closes connections whose sign-in session has been signed out or has expired. */
  async sweepSessions(): Promise<void> {
    const hashes = new Set<string>();
    for (const [, document] of this.hocuspocus.documents) {
      for (const connection of document.connections.keys()) {
        const hash = (connection.context as CollabContext | undefined)?.session?.hash;
        if (hash) hashes.add(hash);
      }
    }
    if (!hashes.size) return;
    try {
      const live = await this.users.liveSessions([...hashes]);
      this.#closeSessions(new Set([...hashes].filter((h) => !live.has(h))));
    } catch (err) {
      this.#log.warn(`Couldn't check sessions: ${String(err)}`);
    }
  }

  #closeSessions(ended: ReadonlySet<string>): void {
    if (!ended.size) return;
    for (const [, document] of this.hocuspocus.documents) {
      for (const connection of document.connections.keys()) {
        const hash = (connection.context as CollabContext | undefined)?.session?.hash;
        if (hash && ended.has(hash)) connection.close({ code: 4401, reason: 'Signed out' });
      }
    }
  }

  /**
   * Before the HTTP server and the database close: stop taking connections, save every open board now (rather than
   * trusting a debounced save to land), then let everyone go.
   */
  async beforeApplicationShutdown(): Promise<void> {
    this.#server?.off('upgrade', this.#onUpgrade);
    // What people edited since the last summary goes in the history before the database closes.
    await this.flushEdits();
    clearInterval(this.#sweep);
    this.#signedOut?.unsubscribe();
    // Save every open board now, rather than trusting a debounced store to land before the database closes.
    await Promise.all(
      [...this.hocuspocus.documents.values()].filter((doc) => !PROJECTION.test(doc.name)).map((doc) =>
        this.boards.storeState(doc.name, Buffer.from(Y.encodeStateAsUpdate(doc))).catch((err: unknown) =>
          this.#log.error(`Couldn't save board ${doc.name} on shutdown: ${String(err)}`),
        ),
      ),
    );
    for (const timer of this.#expiries.values()) clearTimeout(timer);
    this.#expiries.clear();
    this.hocuspocus.closeConnections();
    // Closing a board's connection leaves its socket open, and the socket server doesn't end its clients when it closes;
    // left open, they'd hold the HTTP server's close up forever. Their browsers reconnect to another instance.
    for (const socket of this.#wss.clients) socket.terminate();
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

  /** Lets go of everyone viewing a workspace's boards embedded elsewhere, when it turns embeds off. */
  disconnectEmbeds(orgId: string): void {
    for (const [, document] of this.hocuspocus.documents) {
      for (const connection of document.connections.keys()) {
        if ((connection.context as CollabContext | undefined)?.embedIn === orgId) connection.close();
      }
    }
  }

  /**
   * Lets a share link's viewers go when it expires (now, if it already has), replacing any earlier deadline. Checked
   * against the database when the time comes, in case the link was changed meanwhile. If that check fails, the viewers
   * are let go anyway (it fails closed): the deadline was known, and they can reconnect once the link checks out again.
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
        (err: unknown) => {
          this.#log.warn(`Couldn't check share link ${linkId} at its deadline, so its viewers were let go: ${String(err)}`);
          this.disconnectLink(linkId);
        },
      );
    }, wait);
    timer.unref();
    this.#expiries.set(linkId, timer);
  }

  /** The people with a board open right now (not guests on a share link), once each. */
  peopleOn(boardId: string): { id: string; name: string }[] {
    const people = new Map<string, string>();
    for (const connection of this.hocuspocus.documents.get(boardId)?.connections.keys() ?? []) {
      const context = connection.context as CollabContext | undefined;
      if (context?.user && !context.linkId) people.set(context.user.id, context.user.name);
    }
    return [...people].map(([id, name]) => ({ id, name }));
  }

  disconnect(userId: string, boardIds?: readonly string[]): void {
    for (const [name, document] of this.hocuspocus.documents) {
      if (boardIds && !boardIds.includes(name)) continue;
      for (const connection of document.connections.keys()) {
        if ((connection.context as CollabContext | undefined)?.user?.id === userId) connection.close();
      }
    }
  }

  /** Tells everyone on a board, and participants on its projections, something that isn't in the document. */
  broadcastToBoard(boardId: string, message: string): void {
    for (const [name, document] of this.hocuspocus.documents) {
      if (name === boardId || PROJECTION.exec(name)?.[1] === boardId) document.broadcastStateless(message);
    }
  }

  #logEdit(boardId: string, user: User, doc: Y.Doc, update: Uint8Array): void {
    const key = `${boardId} ${user.id}`;
    let pending = this.#edits.get(key);
    try {
      if (!pending) {
        const timer = setTimeout(() => void this.#flushEdits(key), EDIT_LOG_MS);
        timer.unref();
        pending = { boardId, user, touched: touched(), timer };
        this.#edits.set(key, pending);
      }
      touchedBy(doc, update, pending.touched);
    } catch (err) {
      this.#log.warn(`Couldn't follow ${user.id}'s edit on board ${boardId}: ${String(err)}`);
    }
  }

  /** Puts everyone's edits not yet summed up into the history now. */
  async flushEdits(): Promise<void> {
    await Promise.all([...this.#edits.keys()].map((key) => this.#flushEdits(key)));
  }

  async #flushEdits(key: string): Promise<void> {
    const pending = this.#edits.get(key);
    if (!pending) return;
    this.#edits.delete(key);
    clearTimeout(pending.timer);
    const said = describeEdits(pending.touched);
    if (said) await this.activity.record(pending.boardId, pending.user, 'edited the board', undefined, said);
  }

  /** Brings a board's open projections up to date shortly (its participants or what they may see changed). */
  refreshProjections(boardId: string): void {
    const projected = this.#projected.get(boardId);
    if (!projected || projected.timer) return;
    projected.timer = setTimeout(() => {
      projected.timer = undefined;
      void this.#project(boardId).catch((err: unknown) => this.#log.warn(`Couldn't update projections of ${boardId}: ${String(err)}`));
    }, PROJECT_MS);
    projected.timer.unref();
  }

  /** Lets go of participants on a board (one, or all of them), e.g. once they're blocked or it's closed to feedback. */
  closeProjections(boardId: string, userId?: string): void {
    for (const [name, document] of this.hocuspocus.documents) {
      const projection = PROJECTION.exec(name);
      if (projection?.[1] === boardId && (!userId || projection[2] === userId)) for (const connection of document.connections.keys()) connection.close();
    }
  }

  /** Rebuilds each open projection of a board from it; anyone no longer allowed is let go. */
  async #project(boardId: string, documents: Iterable<[string, Y.Doc & { connections: Map<{ close(): void }, unknown> }]> = this.hocuspocus.documents): Promise<void> {
    const board = this.hocuspocus.documents.get(boardId);
    if (!board) return;
    const { visibility, participants } = await this.participants.forProjection(boardId);
    for (const [name, document] of documents) {
      const projection = PROJECTION.exec(name);
      if (projection?.[1] !== boardId) continue;
      const userId = projection[2];
      if (!visibility || !participants.has(userId) || participants.get(userId)!.blocked) {
        for (const connection of document.connections.keys()) connection.close();
        continue;
      }
      project(board, document, { userId, visibility }, participants);
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

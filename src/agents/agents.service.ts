import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import * as Y from 'yjs';
import { atLeast } from '../access/roles';
import { ActivityService } from '../activity/activity.service';
import { addNotes, frameGroups, framesOf, inFrame, NOTE_SIZE, notesOf, placeNotes, type NoteColor } from '../assist/board-edit';
import { diagramProblem, placeDiagram } from '../assist/diagram-node';
import { addTasks, validTasks, type StoredTask } from '../assist/tasks-doc';
import { BoardsService } from '../boards/boards.service';
import { fragmentText } from '../boards/board-text';
import { CollabService } from '../collab/collab.service';
import { CommentsService } from '../comments/comments.service';
import type { User } from '../db/schema';
import { describe } from '../ledger/ledger-doc';
import { OrgsService } from '../orgs/orgs.service';
import { SearchIndex } from '../search/search-index';
import { Draft, propose, suggestionFrom, suggestionsIn } from '../suggestions/suggestions-doc';
import type { Agent } from '../tokens/tokens.service';
import type {
  AgentBoardDto,
  AgentCommentResultDto,
  AgentSearchHitDto,
  BoardOutlineDto,
  OutlineItemDto,
  OutlineNoteDto,
  ProposalDto,
  ProposeChangesDto,
} from './agents.dto';
import { MAX_PROPOSED_NOTES } from './agents.dto';

/** The most notes an outline holds; a bigger board says it was cut. */
const MAX_OUTLINE_NOTES = 1000;
const MAX_ITEM_CHARS = 2000;

/** How the board's activity names an agent at work: "Ada via Cursor". */
const actorOf = (user: User, agent: Agent) => ({ id: user.id, name: `${user.name} via ${agent.name}` });

/** A search snippet as plain text: Elastic's highlighting off, its escaping undone. */
const plain = (html: string) =>
  html
    .replace(/<\/?mark>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/** Whatever text an item that isn't a note or frame has: its rich text, title, diagram source or name. */
function itemText(node: Y.Map<unknown>): string {
  const text = node.get('text');
  if (text instanceof Y.XmlFragment) return fragmentText(text);
  for (const key of ['title', 'source', 'label', 'name', 'fileName', 'alt']) {
    const v = node.get(key);
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/**
 * What agents can do with Corkboard, through the agent API (/v1) and MCP (/mcp) alike: list, read and search the boards
 * their token's owner can open, propose changes, which people accept or turn down as suggestions, and comment. Each acts
 * as its owner, with their access, and the board's activity names both: "Ada via Cursor".
 */
@Injectable()
export class AgentsService {
  constructor(
    private readonly boards: BoardsService,
    private readonly orgs: OrgsService,
    private readonly collab: CollabService,
    private readonly search: SearchIndex,
    private readonly activity: ActivityService,
    private readonly comments: CommentsService,
  ) {}

  /** Every board the owner can open, in all their workspaces, most recently changed first. */
  async listBoards(user: User): Promise<AgentBoardDto[]> {
    const all: AgentBoardDto[] = [];
    for (const org of await this.orgs.forUser(user.id)) {
      for (const b of await this.boards.list(user, org.id)) {
        all.push({ id: b.id, title: b.title, workspaceId: org.id, workspace: org.name, role: b.role, updatedAt: b.updatedAt.toISOString() });
      }
    }
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Boards whose title or notes match, across the owner's workspaces, leaving out any kept from them. */
  async searchBoards(user: User, query: string): Promise<AgentSearchHitDto[]> {
    const hits: AgentSearchHitDto[] = [];
    for (const org of await this.orgs.forUser(user.id)) {
      const hidden = await this.boards.hiddenFrom(user, org.id);
      try {
        const found = await this.search.search(org.id, query.trim(), hidden);
        hits.push(...found.map((h) => ({ boardId: h.boardId, title: h.title, workspace: org.name, updatedAt: h.updatedAt, snippets: h.snippets.map(plain) })));
      } catch {
        throw new ServiceUnavailableException('Search is unavailable right now');
      }
    }
    return hits;
  }

  /** The board as an outline. */
  async readBoard(user: User, agent: Agent, boardId: string): Promise<BoardOutlineDto> {
    const board = await this.boards.get(user, boardId);
    const workspace = (await this.orgs.forUser(user.id)).find((o) => o.id === board.orgId)?.name ?? '';
    const members = await this.boards.members(user, boardId).catch(() => []);
    const names = new Map(members.map((m) => [m.userId, m.name]));
    const outline = await this.#withDoc(user, boardId, (doc) => {
      const frames = framesOf(doc).sort((a, b) => a.y - b.y || a.x - b.x);
      // Smallest first, so a note in nested frames belongs to the innermost, as the UI decides.
      const bySize = [...frames].sort((a, b) => a.w * a.h - b.w * b.h);
      const all = notesOf(doc).sort((a, b) => a.y - b.y || a.x - b.x);
      const notes = all.slice(0, MAX_OUTLINE_NOTES);
      const inFrames = new Map<string, OutlineNoteDto[]>(frames.map((f) => [f.id, []]));
      const loose: OutlineNoteDto[] = [];
      for (const n of notes) {
        const out: OutlineNoteDto = { id: n.id, text: n.text, color: n.color, ...(n.votes ? { votes: n.votes } : {}) };
        const frame = bySize.find((f) => inFrame({ x: n.x, y: n.y, ...NOTE_SIZE }, f));
        if (frame) inFrames.get(frame.id)!.push(out);
        else loose.push(out);
      }
      const items: Record<string, OutlineItemDto[]> = {};
      doc.getMap<Y.Map<unknown>>('nodes').forEach((node, id) => {
        if (!(node instanceof Y.Map)) return;
        const kind = node.get('kind');
        if (typeof kind !== 'string' || ['note', 'frame', 'connector'].includes(kind)) return;
        (items[kind] ??= []).push({ id, kind, text: itemText(node).slice(0, MAX_ITEM_CHARS) });
      });
      const tasks = validTasks(doc).map((t: StoredTask) => ({
        key: t.key,
        title: t.title,
        status: t.status,
        priority: t.priority,
        ...(t.assignee ? { assignee: names.get(t.assignee) ?? 'Someone who left' } : {}),
        ...(t.due ? { due: t.due } : {}),
        ...(t.noteId ? { noteId: t.noteId } : {}),
      }));
      return {
        frames: frames.map((f) => ({ id: f.id, title: f.title, notes: inFrames.get(f.id)! })),
        notes: loose,
        items,
        tasks,
        pendingSuggestions: suggestionsIn(doc).length,
        truncated: all.length > notes.length,
      };
    });
    await this.activity.record(boardId, actorOf(user, agent), 'read the board');
    return { id: board.id, title: board.title, workspace, role: board.role, canPropose: atLeast(board.role, 'updater'), ...outline };
  }

  /** Puts changes to the board's people as one suggestion, made only when an updater or owner accepts it. */
  async proposeChanges(user: User, agent: Agent, boardId: string, changes: ProposeChangesDto): Promise<ProposalDto> {
    const board = await this.boards.get(user, boardId);
    if (!atLeast(board.role, 'updater')) {
      throw new ForbiddenException(
        `${user.name} is a ${board.role} on this board, so ${agent.name} can read it but not propose changes. An owner can make them an updater.`,
      );
    }
    const notes = changes.notes ?? [];
    const frames = changes.frames ?? [];
    const tasks = changes.tasks ?? [];
    const newNotes = notes.length + frames.reduce((n, f) => n + (f.notes?.length ?? 0), 0);
    if (!notes.length && !frames.length && !tasks.length && !changes.diagram) throw new BadRequestException('Propose at least one of notes, frames, tasks or a diagram');
    if (newNotes > MAX_PROPOSED_NOTES) throw new BadRequestException(`Propose at most ${MAX_PROPOSED_NOTES} new notes at once`);
    if (changes.diagram !== undefined) {
      const problem = diagramProblem(changes.diagram);
      if (problem) throw new BadRequestException(problem);
    }
    const people = tasks.some((t) => t.owner) ? await this.boards.members(user, boardId) : [];
    const byName = new Map(people.filter((m) => m.role).map((m) => [m.name.trim().toLowerCase(), m.userId]));

    const connection = await this.collab.hocuspocus.openDirectConnection(boardId, { user });
    try {
      const doc = connection.document as unknown as Y.Doc;
      const noteIds = new Set(notesOf(doc).map((n) => n.id));
      const frameIds = new Set(framesOf(doc).map((f) => f.id));
      const unknownFrames = notes.map((n) => n.frameId).filter((id): id is string => !!id && !frameIds.has(id));
      if (unknownFrames.length) throw new BadRequestException(`There's no frame on the board with the id ${[...new Set(unknownFrames)].join(', ')}`);
      const unknownNotes = frames.flatMap((f) => f.noteIds ?? []).filter((id) => !noteIds.has(id));
      if (unknownNotes.length) throw new BadRequestException(`These notes aren't on the board: ${[...new Set(unknownNotes)].join(', ')}`);

      const counts = { notesAdded: 0, notesChanged: 0, framesAdded: 0, notesMoved: 0, tasksAdded: 0, diagramsMade: 0 };
      const draft = new Draft(doc);
      draft.edit((d) => {
        const color = (c?: NoteColor) => c ?? 'yellow';
        // Loose notes beside the board; the rest into their frames, below what's there.
        const loose = notes.filter((n) => !n.frameId);
        if (loose.length) counts.notesAdded += addNotes(d, loose.map((n) => ({ text: n.text.trim(), color: color(n.color) }))).length;
        for (const frameId of new Set(notes.map((n) => n.frameId).filter((id): id is string => !!id))) {
          const into = notes.filter((n) => n.frameId === frameId).map((n) => ({ text: n.text.trim(), color: color(n.color), author: 'assistant' }));
          counts.notesAdded += placeNotes(d, into, frameId).length;
        }
        // New frames: their new notes are written first, then everything is moved in together.
        if (frames.length) {
          const groups = frames.map((f) => {
            const written = f.notes?.length ? addNotes(d, f.notes.map((n) => ({ text: n.text.trim(), color: color(n.color) }))) : [];
            counts.notesAdded += written.length;
            return { title: f.title.trim(), noteIds: [...(f.noteIds ?? []), ...written] };
          });
          const written = frames.reduce((n, f) => n + (f.notes?.length ?? 0), 0);
          const made = frameGroups(d, groups);
          counts.framesAdded += made.frameIds.length;
          counts.notesMoved += Math.max(0, made.moved - written);
        }
        if (tasks.length) {
          const known = new Set(notesOf(d).map((n) => n.id));
          const stored = tasks.map((t) => {
            const owner = t.owner?.trim() ?? '';
            const assignee = owner ? byName.get(owner.toLowerCase()) : undefined;
            const title = (owner && !assignee ? `${owner}: ` : '') + t.title.trim();
            return {
              title,
              status: 'todo' as const,
              priority: (t.priority ?? 0) as StoredTask['priority'],
              labels: ['action'],
              ...(assignee ? { assignee } : {}),
              ...(t.due ? { due: t.due } : {}),
              ...(t.noteId && known.has(t.noteId) ? { noteId: t.noteId } : {}),
            };
          });
          counts.tasksAdded += addTasks(d, stored).length;
        }
        if (changes.diagram) {
          placeDiagram(d, changes.diagram);
          counts.diagramsMade++;
        }
      });
      if (draft.empty) throw new BadRequestException('Those changes would change nothing on the board');

      const suggestion = suggestionFrom(
        draft,
        { model: agent.name, agent: true, forId: user.id, forName: user.name, asked: changes.summary?.trim() || `Proposed by ${agent.name}` },
        describe(counts),
      );
      await connection.transact((d) => propose(d, suggestion));
      await this.activity.record(boardId, actorOf(user, agent), 'proposed a change', undefined, suggestion.action);
      return { suggestionId: suggestion.id, action: suggestion.action };
    } finally {
      await connection.disconnect();
    }
  }

  /** A comment on a note, frame or other item, written by the agent for its owner. Commenters and up. */
  async addComment(user: User, agent: Agent, boardId: string, itemId: string, body: string): Promise<AgentCommentResultDto> {
    const board = await this.boards.get(user, boardId);
    if (!atLeast(board.role, 'commenter')) {
      throw new ForbiddenException(`${user.name} is a reader on this board, so ${agent.name} can read it but not comment. An owner can make them a commenter.`);
    }
    const there = await this.#withDoc(user, boardId, (doc) => doc.getMap('nodes').has(itemId));
    if (!there) throw new NotFoundException('That item is not on the board');
    const thread = await this.comments.add(user, boardId, itemId, body, undefined, agent.name);
    return { threadId: thread.id, commentId: thread.comments.at(-1)!.id };
  }

  /** Reads the board's live document: the one people have open, or the saved one. */
  async #withDoc<T>(user: User, boardId: string, read: (doc: Y.Doc) => T): Promise<T> {
    const connection = await this.collab.hocuspocus.openDirectConnection(boardId, { user });
    try {
      return read(connection.document as unknown as Y.Doc);
    } finally {
      await connection.disconnect();
    }
  }
}

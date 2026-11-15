import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { ActivityService } from '../activity/activity.service';
import { CollabService } from '../collab/collab.service';
import { InjectDb, type Db } from '../db/db.module';
import { users, workspaceTemplates, type User } from '../db/schema';
import { OrgsService } from '../orgs/orgs.service';
import { layoutFromBoard, MAX_TEMPLATE_THINGS } from './board-layout';
import { BoardsService } from './boards.service';
import { layoutProblem, type Layout } from './layout';
import type { SavedTemplateDto, SaveTemplateDto } from './saved-templates.dto';
import { previewOf, type BoardTemplate, type TemplateCategory } from './templates';

/** The most templates one workspace keeps. */
const MAX_PER_WORKSPACE = 200;

type Row = typeof workspaceTemplates.$inferSelect & { savedBy: string | null };

/**
 * Templates a workspace makes from its own boards: anyone who can change a board can save it as one, and everyone in the
 * workspace can start from it. Whoever saved it, or an owner, can delete it.
 */
@Injectable()
export class SavedTemplatesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly boards: BoardsService,
    private readonly orgs: OrgsService,
    private readonly collab: CollabService,
    private readonly activity: ActivityService,
  ) {}

  async list(user: User, orgId: string): Promise<SavedTemplateDto[]> {
    const role = await this.orgs.roleIn(user.id, orgId);
    const rows = await this.#rows(orgId);
    return rows.map((r) => this.#dto(r, user, role === 'owner'));
  }

  /** A saved template by id, for a new board in its workspace; null if there's none. */
  async find(user: User, orgId: string, id: string): Promise<BoardTemplate | null> {
    await this.orgs.roleIn(user.id, orgId);
    const [row] = await this.#rows(orgId, id);
    return row ? this.#template(row) : null;
  }

  async save(user: User, boardId: string, body: SaveTemplateDto): Promise<SavedTemplateDto> {
    const board = await this.boards.get(user, boardId, 'updater');
    const connection = await this.collab.hocuspocus.openDirectConnection(boardId, { user });
    let made: ReturnType<typeof layoutFromBoard>;
    try {
      made = layoutFromBoard(connection.document as unknown as Y.Doc, body.keepNotes ?? true);
    } finally {
      await connection.disconnect();
    }
    if (made.things === 0) throw new BadRequestException('This board has nothing a template can keep: frames, notes, text, shapes, tables or views');
    if (made.things > MAX_TEMPLATE_THINGS) throw new BadRequestException(`A template can hold up to ${MAX_TEMPLATE_THINGS} things; this board has ${made.things}. Save it without its notes, or from a smaller board.`);
    const problem = layoutProblem(made.layout);
    if (problem) throw new BadRequestException(`This board can't be a template: ${problem}`);
    const kept = await this.db.$count(workspaceTemplates, eq(workspaceTemplates.orgId, board.orgId));
    if (kept >= MAX_PER_WORKSPACE) throw new BadRequestException(`A workspace keeps up to ${MAX_PER_WORKSPACE} templates; delete one first`);
    const [row] = await this.db
      .insert(workspaceTemplates)
      .values({
        orgId: board.orgId,
        name: body.name.trim(),
        description: body.description?.trim() ?? '',
        category: body.category,
        layout: made.layout,
        agenda: made.agenda.length ? made.agenda : null,
        createdBy: user.id,
      })
      .returning();
    await this.activity.record(boardId, user, 'saved the board as a template', row.name);
    return this.#dto({ ...row, savedBy: user.name }, user, false);
  }

  async remove(user: User, orgId: string, id: string): Promise<void> {
    const role = await this.orgs.roleIn(user.id, orgId);
    const [row] = await this.#rows(orgId, id);
    if (!row) throw new NotFoundException('Template not found');
    if (row.createdBy !== user.id && role !== 'owner') throw new ForbiddenException('Only whoever saved a template, or an owner, can delete it');
    await this.db.delete(workspaceTemplates).where(eq(workspaceTemplates.id, id));
  }

  #rows(orgId: string, id?: string): Promise<Row[]> {
    return this.db
      .select({
        id: workspaceTemplates.id,
        orgId: workspaceTemplates.orgId,
        name: workspaceTemplates.name,
        description: workspaceTemplates.description,
        category: workspaceTemplates.category,
        layout: workspaceTemplates.layout,
        agenda: workspaceTemplates.agenda,
        createdBy: workspaceTemplates.createdBy,
        createdAt: workspaceTemplates.createdAt,
        savedBy: users.name,
      })
      .from(workspaceTemplates)
      .leftJoin(users, eq(users.id, workspaceTemplates.createdBy))
      .where(id ? and(eq(workspaceTemplates.orgId, orgId), eq(workspaceTemplates.id, id)) : eq(workspaceTemplates.orgId, orgId))
      .orderBy(desc(workspaceTemplates.createdAt));
  }

  #template(row: Row): BoardTemplate {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category as TemplateCategory,
      layout: row.layout as Layout,
      ...(Array.isArray(row.agenda) && row.agenda.length ? { agenda: row.agenda as BoardTemplate['agenda'] } : {}),
    };
  }

  #dto(row: Row, user: User, owner: boolean): SavedTemplateDto {
    const t = this.#template(row);
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      columns: (t.layout.frames ?? []).map((f) => f.title),
      preview: previewOf(t),
      layout: t.layout,
      ...(t.agenda ? { agenda: t.agenda } : {}),
      savedBy: row.savedBy,
      savedAt: row.createdAt.getTime(),
      canDelete: owner || row.createdBy === user.id,
    };
  }
}

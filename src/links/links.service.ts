import { BadRequestException, ForbiddenException, GoneException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { ActivityService } from '../activity/activity.service';
import { BoardsService } from '../boards/boards.service';
import { InjectDb, type Db } from '../db/db.module';
import { boards, boardShareLinks, users, type User } from '../db/schema';
import { PoliciesService, EDITABLE_OFF, EMBEDS_OFF, embedRefusal, PASSWORD_NEEDED, tooLong } from '../policies/policies.service';
import { latestExpiry, policyRefusal, type Policies } from '../policies/rules';
import type { ShareLinkDto, SharedBoardDto } from './links.dto';
import { Attempts, checkPass, checkPassword, hashPassword, issuePass } from './link-password';

type LinkRow = typeof boardShareLinks.$inferSelect;

/** Whether a link still opens its board. */
export const isLive = (link: Pick<LinkRow, 'revokedAt' | 'expiresAt'>, now = Date.now()) => !link.revokedAt && (!link.expiresAt || link.expiresAt.getTime() > now);

/** A link that opens, and what it lets its guest do now. */
export interface Admitted {
  link: LinkRow;
  title: string;
  orgId: string;
  /** The link lets guests edit, and the workspace still allows that. */
  canEdit: boolean;
}

/** Share links: made and turned off by whoever the workspace's policy allows; anyone with one can view the board. */
@Injectable()
export class LinksService {
  readonly #attempts = new Attempts();

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly boards: BoardsService,
    private readonly activity: ActivityService,
    private readonly policies: PoliciesService,
  ) {}

  async list(user: User, boardId: string): Promise<ShareLinkDto[]> {
    await this.policies.check(user, await this.boards.get(user, boardId), 'shareLinks');
    const rows = await this.db
      .select({ link: boardShareLinks, by: users.name })
      .from(boardShareLinks)
      .leftJoin(users, eq(users.id, boardShareLinks.createdBy))
      .where(eq(boardShareLinks.boardId, boardId))
      .orderBy(desc(boardShareLinks.createdAt));
    return rows.map(({ link, by }) => toDto(link, by ?? 'Someone'));
  }

  async create(user: User, boardId: string, { label, expiresInDays, canEdit = false, password }: NewLink): Promise<ShareLinkDto> {
    const policies = await this.policies.check(user, await this.boards.get(user, boardId), 'shareLinks');
    if (canEdit && !policies.editableLinks) throw policyRefusal('editableLinks', EDITABLE_OFF);
    if (policies.linkPassword && !password) throw policyRefusal('linkPassword', PASSWORD_NEEDED);
    if (policies.linkMaxDays !== null && (!expiresInDays || expiresInDays > policies.linkMaxDays)) throw policyRefusal('linkMaxDays', tooLong(policies.linkMaxDays));
    const [link] = await this.db
      .insert(boardShareLinks)
      .values({
        boardId,
        token: randomBytes(24).toString('base64url'),
        label: label?.trim() || null,
        canEdit,
        createdBy: user.id,
        expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null,
        passwordHash: password ? await hashPassword(password) : null,
      })
      .returning();
    await this.activity.record(boardId, user, canEdit ? 'made an editable share link' : 'made a share link', link.label ?? undefined, password ? 'With a password' : undefined);
    return toDto(link, user.name);
  }

  async setExpiry(user: User, boardId: string, linkId: string, expiresAt: number | null): Promise<ShareLinkDto> {
    const policies = await this.policies.check(user, await this.boards.get(user, boardId), 'shareLinks');
    const [was] = await this.db.select().from(boardShareLinks).where(and(eq(boardShareLinks.id, linkId), eq(boardShareLinks.boardId, boardId)));
    if (!was) throw new NotFoundException('Link not found');
    const latest = latestExpiry(policies.linkMaxDays, was.createdAt.getTime());
    if (latest !== null && (expiresAt === null || expiresAt > latest)) throw policyRefusal('linkMaxDays', tooLong(policies.linkMaxDays!));
    const [link] = await this.db
      .update(boardShareLinks)
      .set({ expiresAt: expiresAt === null ? null : new Date(expiresAt) })
      .where(eq(boardShareLinks.id, linkId))
      .returning();
    return toDto(link, user.name);
  }

  /**
   * It stops working at once; anyone viewing through it is let go (see CollabService). Board owners can always turn a
   * link off, whoever the policy lets make them.
   */
  async revoke(user: User, boardId: string, linkId: string): Promise<LinkRow> {
    const board = await this.boards.get(user, boardId);
    if (board.role !== 'owner') await this.policies.check(user, board, 'shareLinks');
    const [link] = await this.db
      .update(boardShareLinks)
      .set({ revokedAt: new Date() })
      .where(and(eq(boardShareLinks.id, linkId), eq(boardShareLinks.boardId, boardId)))
      .returning();
    if (!link) throw new NotFoundException('Link not found');
    await this.activity.record(boardId, user, 'revoked a share link', link.label ?? undefined);
    return link;
  }

  /**
   * A read-only link without a password for embedding the board elsewhere: the live one made for that, or a new one
   * (expiring within the workspace's longest). Refused when the workspace turns embeds off or needs passwords.
   */
  async embed(user: User, boardId: string): Promise<ShareLinkDto> {
    const policies = await this.policies.check(user, await this.boards.get(user, boardId), 'shareLinks');
    const why = embedRefusal(policies);
    if (why) throw policyRefusal(policies.embeds ? 'linkPassword' : 'embeds', why);
    const made = await this.db
      .select({ link: boardShareLinks, by: users.name })
      .from(boardShareLinks)
      .leftJoin(users, eq(users.id, boardShareLinks.createdBy))
      .where(and(eq(boardShareLinks.boardId, boardId), eq(boardShareLinks.embed, true), eq(boardShareLinks.canEdit, false), isNull(boardShareLinks.passwordHash), isNull(boardShareLinks.revokedAt)))
      .orderBy(desc(boardShareLinks.createdAt));
    const live = made.find((m) => isLive(m.link));
    if (live) return toDto(live.link, live.by ?? 'Someone');
    const [link] = await this.db
      .insert(boardShareLinks)
      .values({
        boardId,
        token: randomBytes(24).toString('base64url'),
        label: 'Embed',
        embed: true,
        createdBy: user.id,
        expiresAt: policies.linkMaxDays ? new Date(latestExpiry(policies.linkMaxDays)!) : null,
      })
      .returning();
    await this.activity.record(boardId, user, 'made a link to embed the board', link.label ?? undefined);
    return toDto(link, user.name);
  }

  /**
   * The link behind an embed: live, its workspace allowing embeds, and without a password (a page in another tool has
   * nowhere to type it). Always read-only.
   */
  async admitEmbed(token: string): Promise<Admitted> {
    const { link, title, orgId, policies } = await this.#find(token);
    if (!policies.embeds) throw policyRefusal('embeds', EMBEDS_OFF);
    if (link.passwordHash) throw policyRefusal('linkPassword', "This link has a password, so it can't be embedded.");
    return { link, title, orgId, canEdit: false };
  }

  /** For the embed page: what the link shows, counting the open. */
  async openEmbed(token: string): Promise<SharedBoardDto> {
    const { link, title } = await this.admitEmbed(token);
    await this.db
      .update(boardShareLinks)
      .set({ opens: sql`${boardShareLinks.opens} + 1`, lastOpenedAt: new Date() })
      .where(eq(boardShareLinks.id, link.id));
    return { boardId: link.boardId, title, canEdit: false };
  }

  /** A link by id, live or not. */
  async byId(linkId: string): Promise<LinkRow | null> {
    const [link] = await this.db.select().from(boardShareLinks).where(eq(boardShareLinks.id, linkId));
    return link ?? null;
  }

  async #find(token: string): Promise<{ link: LinkRow; title: string; orgId: string; policies: Policies }> {
    const [row] = await this.db
      .select({ link: boardShareLinks, title: boards.title, orgId: boards.orgId })
      .from(boardShareLinks)
      .innerJoin(boards, eq(boards.id, boardShareLinks.boardId))
      .where(eq(boardShareLinks.token, token));
    if (!row) throw new NotFoundException('This link does not open anything');
    if (!isLive(row.link)) throw new GoneException('This link has been turned off or has expired');
    const policies = await this.policies.of(row.orgId);
    if (policies.linkPassword && !row.link.passwordHash) throw policyRefusal('linkPassword', "This workspace's policy now needs a password on share links, so this one no longer opens. Ask for a new link.");
    return { ...row, policies };
  }

  /**
   * The link behind a token, if it opens its board for this guest: live, allowed by the workspace's policies, and with
   * proof of its password (`pass`, from `unlock`) when it has one. Throws why not: 404, 410, or 403 (`passwordRequired`
   * when the password is what's missing).
   */
  async admit(token: string, pass?: string): Promise<Admitted> {
    const { link, title, orgId, policies } = await this.#find(token);
    if (link.passwordHash && !checkPass(pass, link.id, link.passwordHash)) {
      throw new ForbiddenException({ statusCode: 403, error: 'Forbidden', message: 'This link needs its password', passwordRequired: true });
    }
    return { link, title, orgId, canEdit: link.canEdit && policies.editableLinks };
  }

  /** A guest types a link's password: proof to send with what they open, or 403. Guessing is limited (429). */
  async unlock(token: string, password: string, address: string): Promise<string> {
    const { link } = await this.#find(token);
    if (!link.passwordHash) throw new BadRequestException("This link doesn't have a password");
    const wait = this.#attempts.waitFor(link.id, address);
    if (wait) throw new HttpException(`Too many wrong passwords. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`, HttpStatus.TOO_MANY_REQUESTS);
    if (!(await checkPassword(password, link.passwordHash))) {
      this.#attempts.miss(link.id, address);
      throw new ForbiddenException({ statusCode: 403, error: 'Forbidden', message: "That password isn't right", passwordRequired: true });
    }
    return issuePass(link.id, link.passwordHash);
  }

  /** For the shared page: what the link opens, counting the open. */
  async open(token: string, pass?: string): Promise<SharedBoardDto> {
    const { link, title, canEdit } = await this.admit(token, pass);
    await this.db
      .update(boardShareLinks)
      .set({ opens: sql`${boardShareLinks.opens} + 1`, lastOpenedAt: new Date() })
      .where(eq(boardShareLinks.id, link.id));
    return { boardId: link.boardId, title, canEdit };
  }
}

/** What a new share link is to be. */
export interface NewLink {
  label?: string;
  expiresInDays?: number;
  canEdit?: boolean;
  password?: string;
}

function toDto(link: LinkRow, by: string): ShareLinkDto {
  return {
    id: link.id,
    token: link.token,
    label: link.label,
    canEdit: link.canEdit,
    createdBy: by,
    createdAt: link.createdAt.getTime(),
    expiresAt: link.expiresAt?.getTime() ?? null,
    revoked: !!link.revokedAt,
    hasPassword: !!link.passwordHash,
    embed: link.embed,
    opens: link.opens,
    lastOpenedAt: link.lastOpenedAt?.getTime() ?? null,
  };
}

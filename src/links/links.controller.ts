import { Body, Controller, Delete, Get, GoneException, Headers, HttpCode, NotFoundException, Ip, Param, ParseUUIDPipe, Patch, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user';
import { CollabService } from '../collab/collab.service';
import { FilesService, sendFile } from '../files/files.service';
import type { User } from '../db/schema';
import { CreateShareLinkDto, LinkPassDto, SharedBoardDto, ShareLinkDto, ShareLinkExpiryDto, UnlockLinkDto } from './links.dto';
import { LinksService } from './links.service';

/** The header a guest sends proof of a link's password in. */
export const PASS_HEADER = 'x-link-pass';

@ApiTags('links')
@ApiBearerAuth()
@Controller()
export class LinksController {
  constructor(
    private readonly links: LinksService,
    private readonly collab: CollabService,
    private readonly files: FilesService,
  ) {}

  /** Whoever the workspace's policy lets manage links (board owners by default): the board's share links, newest first. */
  @Get('boards/:id/links')
  list(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<ShareLinkDto[]> {
    return this.links.list(user, id);
  }

  /**
   * A link that lets anyone who has it view the board, read-only unless it lets them edit. The workspace's policies
   * decide who may, whether it may be editable, whether it needs a password and how soon it must expire.
   */
  @Post('boards/:id/links')
  create(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreateShareLinkDto): Promise<ShareLinkDto> {
    return this.links.create(user, id, body);
  }

  /**
   * Whoever may make share links: a read-only link without a password to embed the board in Notion, Confluence and
   * the like (the one already made, while it's live). Its page is /embed/{token}; GET /oembed describes it.
   */
  @Post('boards/:id/links/embed')
  @HttpCode(200)
  embed(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<ShareLinkDto> {
    return this.links.embed(user, id);
  }

  @Patch('boards/:id/links/:linkId')
  async setExpiry(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @Body() body: ShareLinkExpiryDto,
  ): Promise<ShareLinkDto> {
    const link = await this.links.setExpiry(user, id, linkId, body.expiresAt);
    // Anyone viewing now is let go at the new time, or at once if it's already passed.
    this.collab.watchLink(link.id, link.expiresAt);
    return link;
  }

  /** Board owners (and whoever the policy lets manage links): turn a link off; anyone viewing through it is let go. */
  @Delete('boards/:id/links/:linkId')
  @HttpCode(204)
  async revoke(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Param('linkId', ParseUUIDPipe) linkId: string): Promise<void> {
    const link = await this.links.revoke(user, id, linkId);
    this.collab.disconnectLink(link.id);
  }

  /** Anyone with a link: a file on the board it opens, while the link is live (410 after). */
  @Public()
  @Get('shared/:token/files/:fileId')
  @ApiProduces('application/octet-stream')
  @ApiHeader({ name: PASS_HEADER, required: false, description: "Proof of the link's password, from unlock" })
  async file(@Param('token') token: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Headers(PASS_HEADER) pass: string | undefined, @Res() res: Response): Promise<void> {
    const { link } = await this.links.admit(token, pass).catch((err: unknown) => {
      throw err instanceof NotFoundException ? new GoneException('This link has been turned off or has expired') : err;
    });
    sendFile(res, await this.files.onBoard(link.boardId, fileId));
  }

  /**
   * Anyone with a link: what it opens. 410 once it's turned off or expired; 403 with `passwordRequired` until the
   * link's password has been typed (send the pass from unlock).
   */
  @Public()
  @Get('shared/:token')
  @ApiHeader({ name: PASS_HEADER, required: false, description: "Proof of the link's password, from unlock" })
  open(@Param('token') token: string, @Headers(PASS_HEADER) pass?: string): Promise<SharedBoardDto> {
    return this.links.open(token, pass);
  }

  /**
   * An embedded board's page: what the link shows. 410 once it's turned off or expired; 403 naming the policy when the
   * workspace turns embeds off or the link has a password.
   */
  @Public()
  @Get('embed/:token')
  openEmbed(@Param('token') token: string): Promise<SharedBoardDto> {
    return this.links.openEmbed(token);
  }

  /** Anyone with a link that has a password: type it. 403 when it's wrong; 429 after too many wrong tries. */
  @Public()
  @Post('shared/:token/unlock')
  @HttpCode(200)
  async unlock(@Param('token') token: string, @Body() body: UnlockLinkDto, @Ip() ip: string): Promise<LinkPassDto> {
    return { pass: await this.links.unlock(token, body.password, ip) };
  }
}

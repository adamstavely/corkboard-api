import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user';
import { CollabService } from '../collab/collab.service';
import type { User } from '../db/schema';
import { CreateShareLinkDto, SharedBoardDto, ShareLinkDto, ShareLinkExpiryDto } from './links.dto';
import { LinksService } from './links.service';

@ApiTags('links')
@ApiBearerAuth()
@Controller()
export class LinksController {
  constructor(
    private readonly links: LinksService,
    private readonly collab: CollabService,
  ) {}

  /** Board owners: the board's share links, newest first. */
  @Get('boards/:id/links')
  list(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<ShareLinkDto[]> {
    return this.links.list(user, id);
  }

  /** Board owners: a link that lets anyone who has it view the board, read-only. */
  @Post('boards/:id/links')
  create(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreateShareLinkDto): Promise<ShareLinkDto> {
    return this.links.create(user, id, body.label, body.expiresInDays);
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

  /** Board owners: turn a link off; anyone viewing through it is let go. */
  @Delete('boards/:id/links/:linkId')
  @HttpCode(204)
  async revoke(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Param('linkId', ParseUUIDPipe) linkId: string): Promise<void> {
    const link = await this.links.revoke(user, id, linkId);
    this.collab.disconnectLink(link.id);
  }

  /** Anyone with a link: what it opens. 410 once it's turned off or expired. */
  @Public()
  @Get('shared/:token')
  open(@Param('token') token: string): Promise<SharedBoardDto> {
    return this.links.open(token);
  }
}

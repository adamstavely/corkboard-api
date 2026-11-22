import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import { BoardsService } from '../boards/boards.service';
import { CollabService } from '../collab/collab.service';
import type { User } from '../db/schema';
import { FeedbackService } from '../feedback/feedback.service';
import { BoardPolicyDto, PoliciesDto } from './policies.dto';
import { PoliciesService } from './policies.service';
import { RetentionService } from './retention.service';

@ApiTags('policies')
@ApiBearerAuth()
@Controller()
export class PoliciesController {
  constructor(
    private readonly policies: PoliciesService,
    private readonly retention: RetentionService,
    private readonly boards: BoardsService,
    private readonly feedback: FeedbackService,
    private readonly collab: CollabService,
  ) {}

  /** Anyone in the workspace: its policies. */
  @Get('orgs/:orgId/policies')
  get(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string): Promise<PoliciesDto> {
    return this.policies.get(user, orgId);
  }

  /**
   * Workspace owners: set the workspace's policies. Share links already out there follow at once: cut short to the
   * longest expiry allowed, and guests on links that no longer qualify are let go (editable ones reconnect read-only).
   * A shorter retention prunes old history now rather than at the next daily run.
   */
  @Put('orgs/:orgId/policies')
  async set(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: PoliciesDto): Promise<PoliciesDto> {
    const { policies, letGo, shortened } = await this.policies.set(user, orgId, body);
    for (const id of letGo) this.collab.disconnectLink(id);
    for (const link of shortened) this.collab.watchLink(link.id, link.expiresAt);
    await this.retention.pruneOrg(orgId);
    return policies;
  }

  /** Anyone on the board: what the workspace's policies let them do on it, with the reason for anything they can't. */
  @Get('boards/:id/policy')
  async onBoard(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<BoardPolicyDto> {
    const board = await this.boards.get(user, id);
    return this.policies.onBoard(user, board, () => this.feedback.facilitates(user, id));
  }
}

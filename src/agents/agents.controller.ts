import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiExtraModels, ApiTags } from '@nestjs/swagger';
import { ForAgents } from '../auth/auth.guard';
import { CurrentAgent } from '../auth/current-agent';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import type { Agent } from '../tokens/tokens.service';
import {
  AgentBoardDto,
  AgentCommentDto,
  AgentCommentResultDto,
  AgentSearchHitDto,
  AgentSearchQueryDto,
  BoardOutlineDto,
  OutlineItemDto,
  ProposalDto,
  ProposeChangesDto,
} from './agents.dto';
import { AgentsService } from './agents.service';

/**
 * The agent API, for tools like Claude Code and Cursor. It takes a personal access token (`Authorization: Bearer cbp_…`,
 * made under Account, Access tokens) and acts as the token's owner, with their access to each board. Agents never
 * change a board directly: what they propose waits as a suggestion for people to accept. Each token may make 60 calls
 * at once and 2 a second after that (429 with Retry-After beyond).
 */
@ApiTags('agents')
@ApiExtraModels(OutlineItemDto)
@ApiBearerAuth()
@Controller('v1')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  /** Scope boards:read. The boards the token's owner can open, in all their workspaces, most recently changed first. */
  @Get('boards')
  @ForAgents('boards:read')
  boards(@CurrentUser() user: User): Promise<AgentBoardDto[]> {
    return this.agents.listBoards(user);
  }

  /** Scope boards:read. A board as an outline: frames with their notes, other notes, everything else by kind, and tasks. */
  @Get('boards/:id')
  @ForAgents('boards:read')
  board(@CurrentUser() user: User, @CurrentAgent() agent: Agent, @Param('id', ParseUUIDPipe) id: string): Promise<BoardOutlineDto> {
    return this.agents.readBoard(user, agent, id);
  }

  /** Scope boards:read. Boards whose title or notes match, best first, with matching passages. */
  @Get('search')
  @ForAgents('boards:read')
  search(@CurrentUser() user: User, @Query() { q }: AgentSearchQueryDto): Promise<AgentSearchHitDto[]> {
    return this.agents.searchBoards(user, q);
  }

  /**
   * Scope boards:propose. Proposes changes as one suggestion on the board, attributed "<token name> for <owner>"; nothing
   * changes until an updater or owner accepts it. The token's owner must be an updater or owner of the board.
   */
  @Post('boards/:id/proposals')
  @ForAgents('boards:propose')
  propose(@CurrentUser() user: User, @CurrentAgent() agent: Agent, @Param('id', ParseUUIDPipe) id: string, @Body() body: ProposeChangesDto): Promise<ProposalDto> {
    return this.agents.proposeChanges(user, agent, id, body);
  }

  /** Scope comments:write. Comments on a note, frame or other item, as its owner via the agent. Commenters and up. */
  @Post('boards/:id/comments')
  @ForAgents('comments:write')
  comment(@CurrentUser() user: User, @CurrentAgent() agent: Agent, @Param('id', ParseUUIDPipe) id: string, @Body() body: AgentCommentDto): Promise<AgentCommentResultDto> {
    return this.agents.addComment(user, agent, id, body.itemId, body.body);
  }
}

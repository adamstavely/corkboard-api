import { Controller, Get, Param, ParseUUIDPipe, Query, ServiceUnavailableException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { BoardsService } from '../boards/boards.service';
import { SearchIndex } from './search-index';
import { SearchHitDto, SearchQueryDto } from './search.dto';

@ApiTags('search')
@ApiBearerAuth()
@Controller('orgs/:orgId/search')
export class SearchController {
  constructor(
    private readonly boards: BoardsService,
    private readonly index: SearchIndex,
  ) {}

  /** Boards in the workspace whose title or notes match the query, leaving out any kept from the person. */
  @Get()
  async search(
    @CurrentUser() user: User,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() { q }: SearchQueryDto,
  ): Promise<SearchHitDto[]> {
    const hidden = await this.boards.hiddenFrom(user, orgId);
    try {
      return await this.index.search(orgId, q.trim(), hidden);
    } catch {
      throw new ServiceUnavailableException('Search is unavailable right now');
    }
  }
}

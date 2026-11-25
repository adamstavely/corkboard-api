import { Body, Controller, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { NameOrgDto, OrgDto } from './orgs.dto';
import { OrgsService } from './orgs.service';

@ApiTags('orgs')
@ApiBearerAuth()
@Controller('orgs')
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  /** Anyone signed in: start a workspace of their own, which they own. Invite people to it from its members. */
  @Post()
  create(@CurrentUser() user: User, @Body() body: NameOrgDto): Promise<OrgDto> {
    return this.orgs.create(user.id, body.name);
  }

  /** Owners: rename the workspace. */
  @Patch(':orgId')
  rename(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: NameOrgDto): Promise<OrgDto> {
    return this.orgs.rename(user.id, orgId, body.name);
  }
}

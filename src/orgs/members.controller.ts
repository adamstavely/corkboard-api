import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { CreateInviteDto, CreatedInviteDto, InviteDto, InviteTokenDto, MembersDto, MyInviteDto, UpdateRoleDto } from './members.dto';
import { MembersService } from './members.service';
import { OrgDto } from './orgs.dto';

@ApiTags('members')
@ApiBearerAuth()
@Controller()
export class MembersController {
  constructor(private readonly members: MembersService) {}

  /** Everyone in the workspace, and the invites waiting to be accepted. */
  @Get('orgs/:orgId/members')
  list(@CurrentUser() user: User, @Param('orgId', ParseUUIDPipe) orgId: string): Promise<MembersDto> {
    return this.members.list(user, orgId);
  }

  /** Owners: change someone's role. The last owner can't step down. */
  @Patch('orgs/:orgId/members/:userId')
  @HttpCode(204)
  async changeRole(
    @CurrentUser() user: User,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: UpdateRoleDto,
  ): Promise<void> {
    await this.members.changeRole(user, orgId, userId, body.role);
  }

  /** Owners: remove someone. Anyone: leave (their own id). The last owner can't go. */
  @Delete('orgs/:orgId/members/:userId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: User,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.members.remove(user, orgId, userId);
  }

  /** Admins: invite an email at a role. Send them the link (/invite/{token}); it's how they join. */
  @Post('orgs/:orgId/invites')
  invite(
    @CurrentUser() user: User,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: CreateInviteDto,
  ): Promise<CreatedInviteDto> {
    return this.members.invite(user, orgId, body.email, body.role);
  }

  @Patch('orgs/:orgId/invites/:inviteId')
  changeInvite(
    @CurrentUser() user: User,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
    @Body() body: UpdateRoleDto,
  ): Promise<InviteDto> {
    return this.members.changeInvite(user, orgId, inviteId, body.role);
  }

  @Delete('orgs/:orgId/invites/:inviteId')
  @HttpCode(204)
  async revokeInvite(
    @CurrentUser() user: User,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
  ): Promise<void> {
    await this.members.revokeInvite(user, orgId, inviteId);
  }

  /** What an invite link is for. A POST, so the secret stays out of URLs and logs. */
  @Post('invites/lookup')
  @HttpCode(200)
  lookup(@Body() body: InviteTokenDto): Promise<MyInviteDto> {
    return this.members.lookup(body.token);
  }

  /** Joins a workspace through an invite link. */
  @Post('invites/accept')
  acceptLink(@CurrentUser() user: User, @Body() body: InviteTokenDto): Promise<OrgDto> {
    return this.members.acceptLink(user, body.token);
  }

  /** Invites waiting for the signed-in person (development picker only; see MembersService). */
  @Get('me/invites')
  mine(@CurrentUser() user: User): Promise<MyInviteDto[]> {
    return this.members.mine(user);
  }

  @Post('me/invites/:inviteId/accept')
  accept(@CurrentUser() user: User, @Param('inviteId', ParseUUIDPipe) inviteId: string): Promise<OrgDto> {
    return this.members.accept(user, inviteId);
  }

  @Post('me/invites/:inviteId/decline')
  @HttpCode(204)
  async decline(@CurrentUser() user: User, @Param('inviteId', ParseUUIDPipe) inviteId: string): Promise<void> {
    await this.members.decline(user, inviteId);
  }
}

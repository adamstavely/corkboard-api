import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { CreateInviteDto, InviteDto, MembersDto, MyInviteDto, UpdateRoleDto } from './members.dto';
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

  /** Admins: change someone's role. The last admin can't step down. */
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

  /** Admins: remove someone. Anyone: leave (their own id). The last admin can't go. */
  @Delete('orgs/:orgId/members/:userId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: User,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.members.remove(user, orgId, userId);
  }

  /** Admins: invite an email at a role; they see it once they sign in with that email, verified. */
  @Post('orgs/:orgId/invites')
  invite(
    @CurrentUser() user: User,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: CreateInviteDto,
  ): Promise<InviteDto> {
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

  /** Invites waiting for the signed-in person. */
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

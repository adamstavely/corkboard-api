import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { AccessTokenDto, CreateAccessTokenDto, CreatedAccessTokenDto } from './tokens.dto';
import { TokensService } from './tokens.service';

/** Your personal access tokens, for agents. Only a signed-in person can use these: an access token can't make or see tokens. */
@ApiTags('tokens')
@ApiBearerAuth()
@Controller('me/tokens')
export class TokensController {
  constructor(private readonly tokens: TokensService) {}

  /** Your tokens, newest first, without the tokens themselves. */
  @Get()
  list(@CurrentUser() user: User): Promise<AccessTokenDto[]> {
    return this.tokens.list(user);
  }

  /** A new token for an agent. The response is the only time `token` is shown. */
  @Post()
  create(@CurrentUser() user: User, @Body() body: CreateAccessTokenDto): Promise<CreatedAccessTokenDto> {
    return this.tokens.create(user, body.name, body.scopes, body.expiresInDays);
  }

  /** Stops a token working, at once. */
  @Delete(':tokenId')
  @HttpCode(204)
  revoke(@CurrentUser() user: User, @Param('tokenId', ParseUUIDPipe) tokenId: string): Promise<void> {
    return this.tokens.revoke(user, tokenId);
  }
}

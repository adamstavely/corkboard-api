import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { Request } from 'express';
import type { User } from '../db/schema';
import { Public } from './auth.guard';
import { CurrentUser } from './current-user';
import {
  AddPasskeyOptionsRequestDto,
  AuthConfigDto,
  PasskeyAnswerDto,
  PasskeyChallengeDto,
  PasskeyDto,
  SessionDto,
  SignUpOptionsRequestDto,
} from './passkeys.dto';
import { PasskeysService } from './passkeys.service';
import { UsersService } from './users.service';

const session = ({ token, user }: { token: string; user: User }): SessionDto => ({ token, person: { id: user.id, name: user.name, email: user.email } });
const challenge = (c: { challengeId: string; options: object }): PasskeyChallengeDto => c as PasskeyChallengeDto;

/** Signing up, in and out with passkeys. */
@ApiTags('auth')
@Controller()
export class PasskeysController {
  constructor(
    private readonly passkeys: PasskeysService,
    private readonly users: UsersService,
  ) {}

  /** Whether the development picker is on, so the sign-in page knows what to offer. */
  @Public()
  @Get('auth/config')
  config(): AuthConfigDto {
    return { picker: this.users.pickerOn };
  }

  /** Signing up, step one: the options for the browser to make a passkey with. */
  @Public()
  @Post('auth/sign-up/options')
  async signUpOptions(@Body() body: SignUpOptionsRequestDto): Promise<PasskeyChallengeDto> {
    return challenge(await this.passkeys.registerOptions(body.name, body.email, body.label ?? 'Passkey'));
  }

  /** Signing up, step two: the new passkey. Makes the account and signs in. */
  @Public()
  @Post('auth/sign-up/verify')
  @HttpCode(200)
  async signUp(@Body() body: PasskeyAnswerDto): Promise<SessionDto> {
    return session(await this.passkeys.registerVerify(body.challengeId, body.response as unknown as RegistrationResponseJSON));
  }

  /** Signing in, step one: a challenge for any of this site's passkeys. */
  @Public()
  @Post('auth/sign-in/options')
  async signInOptions(): Promise<PasskeyChallengeDto> {
    return challenge(await this.passkeys.loginOptions());
  }

  /** Signing in, step two: the passkey's signature. */
  @Public()
  @Post('auth/sign-in/verify')
  @HttpCode(200)
  async signIn(@Body() body: PasskeyAnswerDto): Promise<SessionDto> {
    return session(await this.passkeys.loginVerify(body.challengeId, body.response as unknown as AuthenticationResponseJSON));
  }

  /** Ends this browser's session. */
  @ApiBearerAuth()
  @Post('auth/sign-out')
  @HttpCode(204)
  async signOut(@Req() req: Request): Promise<void> {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) await this.users.endSession(token);
  }

  /** Your passkeys. */
  @ApiBearerAuth()
  @Get('me/passkeys')
  list(@CurrentUser() user: User): Promise<PasskeyDto[]> {
    return this.passkeys.list(user);
  }

  /** Adding a passkey on another device, step one. */
  @ApiBearerAuth()
  @Post('me/passkeys/options')
  async addOptions(@CurrentUser() user: User, @Body() body: AddPasskeyOptionsRequestDto): Promise<PasskeyChallengeDto> {
    return challenge(await this.passkeys.addOptions(user, body.label ?? 'Passkey'));
  }

  /** Adding a passkey, step two. */
  @ApiBearerAuth()
  @Post('me/passkeys/verify')
  add(@CurrentUser() user: User, @Body() body: PasskeyAnswerDto): Promise<PasskeyDto> {
    return this.passkeys.addVerify(user, body.challengeId, body.response as unknown as RegistrationResponseJSON);
  }

  /** Removes one of your passkeys (not the last). */
  @ApiBearerAuth()
  @Delete('me/passkeys/:id')
  @HttpCode(204)
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.passkeys.remove(user, id);
  }
}

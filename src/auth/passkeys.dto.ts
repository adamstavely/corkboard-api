import { IsEmail, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PersonDto } from './people.dto';

/** How this server signs people in. */
export class AuthConfigDto {
  /** The development picker is on: people can pick who they are without signing in. */
  picker!: boolean;
}

export class SignUpOptionsRequestDto {
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  /** What to call the passkey ("MacBook"). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;
}

export class AddPasskeyOptionsRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;
}

/** What the browser needs to make or use a passkey, and the id to answer with. */
export class PasskeyChallengeDto {
  challengeId!: string;
  /** WebAuthn options as JSON, for the browser (e.g. @simplewebauthn/browser). */
  options!: Record<string, unknown>;
}

/** The browser's answer to a passkey prompt. */
export class PasskeyAnswerDto {
  @IsUUID()
  challengeId!: string;

  /** The WebAuthn response as JSON. */
  @IsObject()
  response!: Record<string, unknown>;
}

/** Signed in: send `token` as the bearer token from now on. */
export class SessionDto {
  token!: string;
  person!: PersonDto;
}

export class PasskeyDto {
  id!: string;
  label!: string;
  createdAt!: number;
  lastUsedAt!: number | null;
}

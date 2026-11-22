import { ArrayNotEmpty, ArrayUnique, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { SCOPES, type Scope } from './scopes';

/** One of your access tokens, as the list shows it: never the token itself. */
export class AccessTokenDto {
  id!: string;
  /** What you called it; boards name the agent by it ("Cursor for Ada"). */
  name!: string;
  /** The token's first characters, to tell it apart: "cbp_AbCd1234". */
  prefix!: string;
  scopes!: Scope[];
  /** Epoch ms. */
  createdAt!: number;
  /** Epoch ms; null when it never expires. */
  expiresAt!: number | null;
  /** Epoch ms; null when it's never been used. Updated at most once a minute. */
  lastUsedAt!: number | null;
}

/** A new access token: the only time the token itself is shown. */
export class CreatedAccessTokenDto extends AccessTokenDto {
  /** The token, "cbp_…". Shown once; only its hash is kept. */
  token!: string;
}

export class CreateAccessTokenDto {
  /** What to call it, usually the agent that will use it: "Cursor", "Claude Code". */
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(SCOPES, { each: true })
  scopes!: Scope[];

  /** Days until it stops working; without it, it works until revoked. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}

import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

/** A link that lets anyone who has it view the board, live and read-only. */
export class ShareLinkDto {
  id!: string;
  /** The secret part of the link: the page's URL is /shared/{token}. */
  token!: string;
  label!: string | null;
  /** Whoever has it can change the board, not just look. */
  canEdit!: boolean;
  createdBy!: string;
  /** Epoch ms. */
  createdAt!: number;
  expiresAt!: number | null;
  revoked!: boolean;
  /** Guests type a password before it opens anything. */
  hasPassword!: boolean;
  opens!: number;
  lastOpenedAt!: number | null;
}

export class CreateShareLinkDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  /** Let whoever has the link change the board, not just look. */
  @IsOptional()
  @IsBoolean()
  canEdit?: boolean;

  /** Days until it stops working; without it, it works until revoked. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;

  /** Guests must type this before the link opens anything; kept only as a hash. */
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(200)
  password?: string;
}

/** A guest typing a link's password. */
export class UnlockLinkDto {
  @IsString()
  @MaxLength(200)
  password!: string;
}

/** Proof the password was typed: send it as the X-Link-Pass header (and after the token on the board's socket). */
export class LinkPassDto {
  pass!: string;
}

export class ShareLinkExpiryDto {
  /** Epoch ms; null for no expiry. */
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  expiresAt!: number | null;
}

/** What a share link opens. */
export class SharedBoardDto {
  boardId!: string;
  title!: string;
  /** The link lets its holder change the board. */
  canEdit!: boolean;
}

import { IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';

/** A link that lets anyone who has it view the board, live and read-only. */
export class ShareLinkDto {
  id!: string;
  /** The secret part of the link: the page's URL is /shared/{token}. */
  token!: string;
  label!: string | null;
  createdBy!: string;
  /** Epoch ms. */
  createdAt!: number;
  expiresAt!: number | null;
  revoked!: boolean;
  opens!: number;
  lastOpenedAt!: number | null;
}

export class CreateShareLinkDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  /** Days until it stops working; without it, it works until revoked. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
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
}

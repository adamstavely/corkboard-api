import { Type } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class CommentAuthorDto {
  /** Null once their account is gone. */
  id!: string | null;
  name!: string;
}

export class CommentDto {
  id!: string;
  author!: CommentAuthorDto;
  body!: string;
  createdAt!: Date;
}

/** A spot on an image, as fractions of its width and height from the top left. */
export class AnchorDto {
  @IsNumber()
  @Min(0)
  @Max(1)
  x!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  y!: number;
}

/** The conversation about one note or frame (or a spot on an image), oldest comment first. */
export class CommentThreadDto {
  id!: string;
  /** The note or frame's id in the board's document (it may since have been deleted); a pin's is "<image id>@<pin id>". */
  nodeId!: string;
  /** Where a pinned comment sits on its image. */
  anchor!: AnchorDto | null;
  resolvedAt!: Date | null;
  comments!: CommentDto[];
}

export class AddCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nodeId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body!: string;

  /** Starting a comment pinned to a spot on an image: where. Kept from the thread's first comment. */
  @IsOptional()
  @ValidateNested()
  @Type(() => AnchorDto)
  anchor?: AnchorDto;
}

export class ResolveThreadDto {
  @IsBoolean()
  resolved!: boolean;
}

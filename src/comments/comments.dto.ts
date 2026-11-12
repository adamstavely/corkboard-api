import { IsBoolean, IsNotEmpty, IsString, MaxLength } from 'class-validator';

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

/** The conversation about one note or frame, oldest comment first. */
export class CommentThreadDto {
  id!: string;
  /** The note or frame's id in the board's document; it may since have been deleted. */
  nodeId!: string;
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
}

export class ResolveThreadDto {
  @IsBoolean()
  resolved!: boolean;
}

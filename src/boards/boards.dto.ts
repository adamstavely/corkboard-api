import { IsBase64, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class BoardDto {
  id!: string;
  orgId!: string;
  title!: string;
  createdAt!: Date;
  updatedAt!: Date;
}

export class CreateBoardDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;
}

export class UpdateBoardDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;
}

/** A board's content: its Yjs document encoded as a single update, in base64. Empty for a new board. */
export class BoardDocumentDto {
  @IsString()
  @IsBase64()
  state!: string;
}

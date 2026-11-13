import { IsNotEmpty, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

export class FolderDto {
  id!: string;
  name!: string;
}

export class FolderNameDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;
}

export class MoveBoardDto {
  /** The folder to file it in; null to take it out of its folder. */
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  folderId!: string | null;
}

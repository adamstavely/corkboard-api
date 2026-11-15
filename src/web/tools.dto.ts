import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { SEARCH_PROVIDERS, type SearchProvider } from './web';

/** What a workspace's assistant may use beyond the board, as anyone in it sees it: never the key, only whether there is one. */
export class WorkspaceToolsDto {
  /** The assistant may search the web and read public pages. */
  webSearch!: boolean;
  @ApiProperty({ enum: SEARCH_PROVIDERS, nullable: true })
  searchProvider!: SearchProvider | null;
  hasSearchKey!: boolean;
}

export class UpdateWorkspaceToolsDto {
  @IsOptional()
  @IsBoolean()
  webSearch?: boolean;

  @ApiProperty({ enum: SEARCH_PROVIDERS, nullable: true, required: false })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(SEARCH_PROVIDERS)
  searchProvider?: SearchProvider | null;

  /** The search service's API key, stored encrypted; an empty string removes it. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  searchKey?: string;
}

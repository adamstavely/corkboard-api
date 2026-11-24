import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SEARCH_PROVIDERS, type SearchProvider } from './web';

/** What a workspace's assistant may use beyond the board, as anyone in it sees it. */
export class WorkspaceToolsDto {
  /** The assistant may search the web and read public pages. */
  webSearch!: boolean;
  /** Whether the site has a search service for web search (its site admins set it). */
  searchAvailable!: boolean;
  /** The assistant may make mini-apps on the workspace's boards. */
  miniApps!: boolean;
}

/** A workspace's switches; the search service is the site's. */
export class UpdateWorkspaceToolsDto {
  @IsOptional()
  @IsBoolean()
  webSearch?: boolean;

  @IsOptional()
  @IsBoolean()
  miniApps?: boolean;
}

/** The site's search service for the assistant's web search, as its site admins see it: never the key. */
export class SiteSearchDto {
  @ApiProperty({ enum: SEARCH_PROVIDERS, nullable: true })
  provider!: SearchProvider | null;
  hasKey!: boolean;
}

export class UpdateSiteSearchDto {
  @ApiProperty({ enum: SEARCH_PROVIDERS })
  @IsIn(SEARCH_PROVIDERS)
  provider!: SearchProvider;

  /** The service's API key, stored encrypted; leave it out to keep the one there is, or send "" to remove it. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  key?: string;
}

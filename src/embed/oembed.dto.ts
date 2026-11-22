import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** What an oEmbed consumer (Notion, Confluence, Iframely) asks about an embed page. */
export class OembedQueryDto {
  /** The embed page: https://<corkboard>/embed/<token>. */
  @IsString()
  @MaxLength(2000)
  url!: string;

  /** Only json is offered; anything else is answered 501, as oEmbed asks. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  format?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(4000)
  maxwidth?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(4000)
  maxheight?: number;
}

/** An oEmbed "rich" answer: the board in an iframe. */
export class OembedDto {
  @ApiProperty({ enum: ['1.0'] })
  version!: '1.0';
  @ApiProperty({ enum: ['rich'] })
  type!: 'rich';
  title!: string;
  provider_name!: string;
  provider_url!: string;
  /** The iframe to put in the page. */
  html!: string;
  width!: number;
  height!: number;
  /** Seconds a consumer may keep this answer. */
  cache_age!: number;
}

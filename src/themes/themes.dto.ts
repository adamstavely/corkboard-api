import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { THEME_FONTS, type ThemeFont } from './diagram-theme';

/** The text colour on a theme's fills, in light and dark. */
export class ThemeInkDto {
  @IsString()
  light!: string;
  @IsString()
  dark!: string;
}

/**
 * A look for diagrams: six fills (for the board's blue, green, yellow, purple, pink and grey, in that order) in light
 * and dark, the text colour on them, a font and a corner radius. Text on every fill meets WCAG 2.2 AA.
 */
export class DiagramThemeDto {
  @IsString()
  @MaxLength(60)
  name!: string;
  @ApiProperty({ type: [String], minItems: 6, maxItems: 6 })
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  light!: string[];
  @ApiProperty({ type: [String], minItems: 6, maxItems: 6 })
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  dark!: string[];
  @ValidateNested()
  @Type(() => ThemeInkDto)
  ink!: ThemeInkDto;
  @ApiProperty({ enum: THEME_FONTS })
  @IsIn(THEME_FONTS)
  font!: ThemeFont;
  @IsInt()
  @Min(0)
  @Max(24)
  radius!: number;
}

/** A workspace's look for diagrams: its own, or Trench Coat's when it has none. */
export class DiagramLookDto {
  /** Whether the workspace set its own (else this is Trench Coat's). */
  custom!: boolean;
  theme!: DiagramThemeDto;
}

/** Where to start a suggested look: a website to read, or brand colours (from a brand guide). */
export class SuggestThemeDto {
  @ApiPropertyOptional({ description: 'A public web page whose styles give the colours, font and corners.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  url?: string;
  @ApiPropertyOptional({ type: [String], description: 'Brand colours, as #rrggbb, most important first.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  colours?: string[];
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;
}

/** A suggested look, not saved yet, and how it was made. */
export class ThemeSuggestionDto {
  theme!: DiagramThemeDto;
  notes!: string[];
}

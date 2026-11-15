import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { BoardTemplateDto } from './boards.dto';
import { TEMPLATE_CATEGORIES, type TemplateCategory } from './templates';

export class SaveTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiProperty({ enum: TEMPLATE_CATEGORIES })
  @IsIn(TEMPLATE_CATEGORIES)
  category!: TemplateCategory;

  /** Keep the notes' words (prompts, examples); without them only the structure is saved. Kept by default. */
  @IsOptional()
  @IsBoolean()
  keepNotes?: boolean;
}

/** A template someone in the workspace saved from a board. */
export class SavedTemplateDto extends BoardTemplateDto {
  /** Who saved it, if they're still around. */
  savedBy!: string | null;
  /** Epoch ms. */
  savedAt!: number;
  /** Whether this person may delete it: whoever saved it, and the workspace's owners. */
  canDelete!: boolean;
}

import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

/** An image or file on a board. Its bytes come from GET /boards/{id}/files/{fileId}. */
export class BoardFileDto {
  id!: string;
  name!: string;
  mime!: string;
  size!: number;
}

/** A pin or box someone put on an image, in fractions of its width and height from the top left. */
export class ImageMarkDto {
  @IsString()
  @MaxLength(64)
  id!: string;

  @IsIn(['pin', 'box'])
  kind!: 'pin' | 'box';

  @IsNumber()
  @Min(0)
  @Max(1)
  x!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  y!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  w?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  h?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  question?: string;
}

export class AskImageDto {
  @IsUUID()
  modelId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  question!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ImageMarkDto)
  marks?: ImageMarkDto[];
}

export class ImageAnswerDto {
  /** The answer to the overall question. */
  answer!: string;
  /** Answers about each mark, by its id. */
  answers!: Record<string, string>;
}

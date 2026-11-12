import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SearchQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  q!: string;
}

/** A board that matches, with the passages of its notes that do. */
export class SearchHitDto {
  boardId!: string;
  title!: string;
  updatedAt!: string;
  /** Matching passages as HTML-escaped text, with the matches wrapped in <mark>. */
  snippets!: string[];
}

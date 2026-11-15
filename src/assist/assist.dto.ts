import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

/** One earlier turn of the conversation in the assistant panel. */
export class AssistTurnDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MaxLength(20_000)
  text!: string;
}

export class AssistRequestDto {
  /** Which of the workspace's models to ask. */
  @IsUUID()
  modelId!: string;

  /** What the person wants: a question about the board, or something to do on it. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  instruction!: string;

  /** Notes to focus on (a selection); without them, the whole board. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  noteIds?: string[];

  /** Put the model's changes to the person as a suggestion instead of making them; by default, as their "ask first" setting says. */
  @IsOptional()
  @IsBoolean()
  propose?: boolean;

  /** The conversation so far, oldest first, without this message; for follow-up questions. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AssistTurnDto)
  history?: AssistTurnDto[];
}

/** A file on the board an answer drew on. */
export class CitedFileDto {
  fileId!: string;
  name!: string;
}

/** A web page an answer drew on. */
export class CitedPageDto {
  url!: string;
  title!: string;
}

export class AssistResultDto {
  /** The model's answer, for the person who asked. */
  reply!: string;
  notesAdded!: number;
  notesChanged!: number;
  /** Frames the model made, to group notes or hold action items. */
  framesAdded!: number;
  /** Existing notes the model moved into frames. */
  notesMoved!: number;
  /** Notes the answer is about, most relevant first, for the person to find on the board. */
  citedNoteIds!: string[];
  /** The board's files the answer drew on. */
  citedFiles!: CitedFileDto[];
  /** The web pages the answer drew on. */
  citedPages!: CitedPageDto[];
  /** When the model's changes were put as a suggestion (see the board's `suggestions`) instead of made: its id. */
  suggestionId!: string | null;
}

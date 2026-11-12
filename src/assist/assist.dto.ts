import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

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

  /** The conversation so far, oldest first, without this message; for follow-up questions. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AssistTurnDto)
  history?: AssistTurnDto[];
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
}

import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

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
}

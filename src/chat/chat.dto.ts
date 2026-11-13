import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class SendChatDto {
  @IsString()
  @Matches(/\S/, { message: 'Write something first' })
  @MaxLength(4000)
  text!: string;

  /** Whether the model answers this message (it was @-mentioned, or the sender has it answer everything). */
  @IsBoolean()
  answer!: boolean;

  /** Which of the workspace's models answers; needed when `answer` is set. */
  @IsOptional()
  @IsUUID()
  modelId?: string;

  /** The sender's selected notes, for the model to focus on; without them, the whole board. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  noteIds?: string[];
}

/** A message as stored in the board's chat. */
export class ChatMessageDto {
  id!: string;
  authorId!: string;
  name!: string;
  at!: number;
  text!: string;
}

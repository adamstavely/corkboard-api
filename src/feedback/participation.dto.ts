import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { NOTE_COLORS } from '../assist/board-edit';
import { REACTIONS } from '../reactions/reactions';

export class AddParticipantNoteDto {
  @IsString()
  @MaxLength(2000)
  text!: string;

  @ApiProperty({ enum: NOTE_COLORS })
  @IsIn(NOTE_COLORS)
  color!: (typeof NOTE_COLORS)[number];

  /** Its top-left corner, in board pixels. */
  @IsNumber()
  @Min(-1_000_000)
  @Max(1_000_000)
  x!: number;

  @IsNumber()
  @Min(-1_000_000)
  @Max(1_000_000)
  y!: number;
}

export class EditParticipantNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;

  @ApiProperty({ enum: NOTE_COLORS, required: false })
  @IsOptional()
  @IsIn(NOTE_COLORS)
  color?: (typeof NOTE_COLORS)[number];

  @IsOptional()
  @IsNumber()
  @Min(-1_000_000)
  @Max(1_000_000)
  x?: number;

  @IsOptional()
  @IsNumber()
  @Min(-1_000_000)
  @Max(1_000_000)
  y?: number;
}

export class ParticipantNoteDto {
  id!: string;
}

export class ParticipantReactDto {
  @IsString()
  @MaxLength(64)
  nodeId!: string;

  @ApiProperty({ enum: REACTIONS })
  @IsIn(REACTIONS)
  emoji!: string;

  @IsBoolean()
  on!: boolean;
}

export class ParticipantVoteDto {
  @IsString()
  @MaxLength(64)
  noteId!: string;

  @IsBoolean()
  add!: boolean;
}

export class ParticipantAnswerDto {
  @IsInt()
  @Min(0)
  @Max(7)
  answer!: number;
}

export class ParticipantCommentDto {
  /** A note or frame on the board. */
  @IsString()
  @MaxLength(200)
  nodeId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body!: string;
}

/** A comment as a participant sees it: who said it as the board allows ("You", "The team", a name or "Participant 4"). */
export class ParticipantCommentViewDto {
  id!: string;
  by!: string;
  mine!: boolean;
  body!: string;
  createdAt!: number;
}

export class ParticipantCommentThreadDto {
  id!: string;
  nodeId!: string;
  resolved!: boolean;
  comments!: ParticipantCommentViewDto[];
}

/** Who you are on the board's projection: the key your own notes and votes carry there. */
export class ParticipantYouDto {
  key!: string;
  visibility!: 'names' | 'anonymous' | 'own';
}

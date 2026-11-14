import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { NOTE_COLORS, type NoteColor } from '../assist/board-edit';

export class StartWritingDto {
  /** Revealed notes carry no author's name. */
  @IsBoolean()
  anonymous!: boolean;

  /** A frame to put the notes in when they're revealed; else they go beside the board's notes. */
  @IsOptional()
  @IsUUID()
  frameId?: string;
}

export class WriteDraftDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  text!: string;

  @ApiProperty({ enum: NOTE_COLORS, required: false })
  @IsOptional()
  @IsIn(NOTE_COLORS)
  color?: NoteColor;
}

/** One of your notes in a hidden writing round: only you see it until it's revealed. */
export class NoteDraftDto {
  id!: string;
  text!: string;
  color!: string;
  at!: number;
}

/** What a reveal put on the board. */
export class RevealedDto {
  revealed!: number;
}

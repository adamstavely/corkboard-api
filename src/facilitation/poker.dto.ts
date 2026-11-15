import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { DECKS, type Deck } from './poker-doc';

const CARDS = [...new Set(Object.values(DECKS).flat())];

export class StartPokerDto {
  /** Story points on a Fibonacci scale, or T-shirt sizes. */
  @IsIn(Object.keys(DECKS))
  deck!: Deck;

  /** A task on the board's kanban to estimate; "Set estimate" can then write the result to it. */
  @IsOptional()
  @IsUUID()
  taskId?: string;

  /** Or a note on the board. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  noteId?: string;

  /** What's being estimated, in words; the task's or note's own text when left out. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}

export class PokerEstimateDto {
  /** A card from the round's deck. */
  @ApiProperty({ enum: CARDS })
  @IsIn(CARDS)
  value!: string;
}

export class MyEstimateDto {
  /** Your estimate in the running round, or null if you haven't given one. */
  @ApiProperty({ type: String, nullable: true })
  value!: string | null;
}

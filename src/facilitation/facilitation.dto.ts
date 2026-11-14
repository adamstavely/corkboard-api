import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class SetVotingDto {
  /** Opens a new round (clearing the last one's votes), or closes the current one. */
  @IsBoolean()
  open!: boolean;

  /** Votes each person gets in a new round. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  votesEach?: number;
}

export class CastVoteDto {
  @IsUUID()
  noteId!: string;

  /** Adds a vote, or takes one back. */
  @IsBoolean()
  add!: boolean;
}

export class SetTimerDto {
  /** How long, from now; null stops the timer. */
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(10)
  @Max(3600)
  seconds!: number | null;

  /** What the time is for, e.g. "Add notes". */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;
}

export class StartBreakoutsDto {
  /** A frame for each group to work in. */
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  frameIds!: string[];

  /** Each group's time, if they get a timer. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  minutes?: number;
}

export class JoinBreakoutDto {
  @IsUUID()
  frameId!: string;
}

export class BreakoutTimerDto {
  /** How long, from now; null stops the group's timer. */
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(10)
  @Max(7200)
  seconds!: number | null;
}

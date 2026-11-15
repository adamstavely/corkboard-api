import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';

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

/** What the facilitator is looking at: the board point in the middle of their view, and their zoom. */
export class BringEveryoneDto {
  @IsNumber()
  cx!: number;

  @IsNumber()
  cy!: number;

  @IsNumber()
  @Min(0.05)
  @Max(8)
  zoom!: number;
}

/** One step of the agenda. */
export class AgendaStepDto {
  /** Keeps a step's place when the agenda is edited while it runs; a new step can leave it out. */
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  title!: string;

  /** How long it gets; 0 for no timer. */
  @IsInt()
  @Min(0)
  @Max(3600)
  seconds!: number;

  /** The frame everyone is brought to when the step starts. */
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsUUID()
  frameId?: string | null;
}

export class SetAgendaDto {
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AgendaStepDto)
  steps!: AgendaStepDto[];
}

export class AgendaGoDto {
  /** The step to go to, counting from 0; null ends the session's agenda. */
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  step!: number | null;
}

import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';

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

/** What a step runs when it starts; moving on from the step wraps it up. */
export class StepActivityDto {
  /** Hidden writing, a dot vote, or a poll. */
  @IsIn(['writing', 'vote', 'poll'])
  kind!: 'writing' | 'vote' | 'poll';

  /** Hidden writing: revealed notes carry no author's name. */
  @ValidateIf((o: StepActivityDto) => o.kind === 'writing')
  @IsBoolean()
  anonymous?: boolean;

  /** A vote: votes each person gets. */
  @ValidateIf((o: StepActivityDto) => o.kind === 'vote')
  @IsInt()
  @Min(1)
  @Max(20)
  votesEach?: number;

  /** A poll: its question. */
  @ValidateIf((o: StepActivityDto) => o.kind === 'poll')
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  question?: string;

  /** A poll: a question with options, or fist-to-five. */
  @ValidateIf((o: StepActivityDto) => o.kind === 'poll')
  @IsIn(['choice', 'fist'])
  pollKind?: 'choice' | 'fist';

  /** A choice poll: two to eight options. */
  @ValidateIf((o: StepActivityDto) => o.kind === 'poll' && o.pollKind === 'choice')
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(80, { each: true })
  options?: string[];
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

  /** What the step runs when it starts, if anything. */
  @IsOptional()
  @ValidateNested()
  @Type(() => StepActivityDto)
  activity?: StepActivityDto | null;
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

export class StartPollDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  question!: string;

  /** A question with options, or fist-to-five: 0 to 5 fingers. */
  @IsIn(['choice', 'fist'])
  kind!: 'choice' | 'fist';

  /** For a choice poll: two to eight options. */
  @ValidateIf((o: StartPollDto) => o.kind === 'choice')
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(80, { each: true })
  options?: string[];
}

export class EndPollDto {
  /** Clears the poll away, rather than closing it to show its result. */
  @IsOptional()
  @IsBoolean()
  clear?: boolean;
}

export class AnswerPollDto {
  /** An option's index, from 0; or for fist-to-five, fingers from 0 to 5. */
  @IsInt()
  @Min(0)
  @Max(7)
  answer!: number;
}

export class SetPrivacyDto {
  /** Hides everyone's pointers, selections and names (but the facilitator's), or shows them again. */
  @IsBoolean()
  on!: boolean;
}

export class SeenFramesDto {
  /** Frames this person has had in view for a few seconds. */
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  frameIds!: string[];
}

/** One team member's part in the session. */
export class PersonPartDto {
  id!: string;
  name!: string;
  /** Has the board open now. */
  online!: boolean;
  /** Notes added this session that are still on the board; never anonymous ones. */
  notes!: number;
  /** Dot votes in this session's round. */
  votes!: number;
  comments!: number;
  /** Messages in the board's chat. */
  chat!: number;
}

export class TeamPartDto {
  people!: number;
  online!: number;
  /** How many have added nothing yet. */
  quiet!: number;
  notes!: number;
  votes!: number;
  comments!: number;
  chat!: number;
}

/** Feedback participants from outside the team: only ever counted. */
export class ParticipantsPartDto {
  people!: number;
  online!: number;
  notes!: number;
  votes!: number;
  comments!: number;
}

/** A hidden writing round under way: how many notes from how many people, never what or whose. */
export class WritingPartDto {
  open!: boolean;
  notes!: number;
  writers!: number;
}

export class FramePartDto {
  id!: string;
  title!: string;
  /** How many people had it in view for a few seconds. */
  viewers!: number;
  /** How many people added notes in it. */
  contributors!: number;
  /** Notes added in it this session, anonymous ones too. */
  notes!: number;
}

/** Who has taken part in the session, for the facilitator. */
export class ParticipationDto {
  /** Where the session starts, epoch ms: when the agenda started, or 3 hours ago without one. */
  since!: number;
  /** Whether `since` is when the agenda started. */
  fromAgenda!: boolean;
  /** Private mode is on: nobody is listed, there are only totals. */
  private!: boolean;
  /** Team members who were here or took part, quietest first; empty in private mode. */
  people!: PersonPartDto[];
  team!: TeamPartDto;
  participants!: ParticipantsPartDto;
  /** Notes from anonymous writing rounds this session. */
  anonymousNotes!: number;
  writing!: WritingPartDto;
  /** The board's frames, those nobody has looked at first. */
  frames!: FramePartDto[];
}

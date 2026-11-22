import { IsUUID } from 'class-validator';

export class RecapRequestDto {
  /** Which of the workspace's models writes it. */
  @IsUUID()
  modelId!: string;
}

class RecapItemDto {
  text!: string;
  /** Ids of the notes it rests on. */
  sources!: string[];
}

class RecapActionDto {
  text!: string;
  /** Who does it, as the board names them; absent when nobody's named. */
  owner?: string;
  /** When, as the board says it ("Friday", "next sprint"), if it does. */
  due?: string;
  sources!: string[];
}

class RecapResultItemDto {
  /** The note, option, finger count or estimate; or, for the agenda, the step. */
  label!: string;
  /** How many voted, answered or estimated it; absent for agenda steps. */
  count?: number;
}

/**
 * What one of the session's activities came to, counted from the board rather than written by the model: never who
 * voted, answered or estimated what.
 */
export class RecapResultDto {
  kind!: 'agenda' | 'vote' | 'poll' | 'estimate';
  /** The poll's question, the vote's agenda step ("Dot vote" when none), what was estimated, or "Steps run". */
  title!: string;
  /** True while the vote or poll was still open when the recap was written. */
  open?: boolean;
  items!: RecapResultItemDto[];
}

/** A session's outcome: what was decided, who does what next, and what's still open. */
export class SessionRecapDto {
  title!: string;
  decisions!: RecapItemDto[];
  actions!: RecapActionDto[];
  /** Questions the session left open. */
  questions!: string[];
  /** The session's votes, polls, estimates and agenda steps, with exact counts. */
  results!: RecapResultDto[];
  /** The model's name, and who asked. */
  model!: string;
  by!: string;
  at!: number;
}

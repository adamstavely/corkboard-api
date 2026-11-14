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

/** A session's outcome: what was decided, who does what next, and what's still open. */
export class SessionRecapDto {
  title!: string;
  decisions!: RecapItemDto[];
  actions!: RecapActionDto[];
  /** Questions the session left open. */
  questions!: string[];
  /** The model's name, and who asked. */
  model!: string;
  by!: string;
  at!: number;
}

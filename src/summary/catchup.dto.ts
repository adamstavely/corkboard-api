import { IsInt, IsUUID, Min } from 'class-validator';

export class CatchUpRequestDto {
  @IsUUID()
  modelId!: string;

  /** When they were last here (epoch ms): what others did after it. */
  @IsInt()
  @Min(0)
  since!: number;
}

export class CatchUpPointDto {
  text!: string;
  /** The notes it's about, to show them. */
  noteIds!: string[];
}

export class CatchUpDto {
  summary!: string;
  points!: CatchUpPointDto[];
  /** How many things others did, as the history has them. */
  events!: number;
  since!: number;
}

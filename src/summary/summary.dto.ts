import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class SummariseDto {
  /** Which of the workspace's models writes it. */
  @IsUUID()
  modelId!: string;

  @IsOptional()
  @IsIn(['short', 'detailed'])
  length?: 'short' | 'detailed';
}

class SummaryPointDto {
  id!: string;
  text!: string;
  /** Ids of the notes it rests on. */
  sources!: string[];
}

export class BoardSummaryDto {
  tldr!: string;
  summary!: string;
  points!: SummaryPointDto[];
  questions!: string[];
  length!: 'short' | 'detailed';
  model!: string;
  by!: string;
  at!: number;
  basis!: string[];
  /** A hash of every note's content when it was made; the board has moved on when it differs. */
  fingerprint?: string;
}

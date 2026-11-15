import { IsString, MaxLength } from 'class-validator';

export class BoardUsageDto {
  id!: string;
  title!: string;
  /** Epoch ms of its last change. */
  updatedAt!: number;
  /** In the last 30 days: things done on it, people who opened it, and model tokens spent on it. */
  events!: number;
  visitors!: number;
  tokens!: number;
}

export class ModelSpendDto {
  /** The connection, or null if it's since been removed. */
  providerId!: string | null;
  label!: string;
  calls!: number;
  inputTokens!: number;
  outputTokens!: number;
  /** In the workspace's own currency units, from the prices an owner set; null without them. */
  cost!: number | null;
}

/** A workspace's last 30 days. */
export class WorkspaceUsageDto {
  since!: number;
  boards!: BoardUsageDto[];
  models!: ModelSpendDto[];
  totals!: { boards: number; events: number; inputTokens: number; outputTokens: number; cost: number | null };
}

export class DeleteWorkspaceDto {
  /** The workspace's name, typed out, to be sure. */
  @IsString()
  @MaxLength(200)
  confirm!: string;
}

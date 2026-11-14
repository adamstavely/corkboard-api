import { IsOptional, IsString, MaxLength } from 'class-validator';

export class BoardEventDto {
  id!: string;
  /** Epoch ms. */
  at!: number;
  actor!: string;
  action!: string;
  target!: string | null;
  detail!: string | null;
}

export class BoardVersionDto {
  id!: string;
  label!: string;
  /** Epoch ms. */
  at!: number;
  /** Who saved it; null for the saves made as people edit. */
  by!: string | null;
}

/** A restore that happened: the version saved just before it, which is what undoing it brings back. */
export class RestoredDto {
  /** The board as it was before this restore, saved as a version; restore it to undo. */
  beforeVersionId!: string;
}

export class SaveVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

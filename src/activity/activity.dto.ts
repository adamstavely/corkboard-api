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

export class SaveVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

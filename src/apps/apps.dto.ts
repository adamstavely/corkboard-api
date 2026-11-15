import { IsInt, Min } from 'class-validator';

/** One version of a mini-app, without its code. */
export class AppVersionSummaryDto {
  version!: number;
  /** What changed, in a line. */
  note!: string;
  /** The model that wrote it, if one did. */
  model!: string | null;
  createdAt!: Date;
}

/** A mini-app on a board and its versions, newest first. */
export class AppDto {
  id!: string;
  title!: string;
  latest!: number;
  versions!: AppVersionSummaryDto[];
}

/** One version of a mini-app, with its code. */
export class AppVersionDto extends AppVersionSummaryDto {
  html!: string;
}

export class RestoreAppDto {
  @IsInt()
  @Min(1)
  version!: number;
}

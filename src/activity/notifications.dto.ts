import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class NotificationDto {
  id!: string;
  kind!: string;
  actor!: string | null;
  title!: string;
  body!: string | null;
  context!: string | null;
  link!: string | null;
  /** Epoch ms. */
  at!: number;
  read!: boolean;
}

export class ReadNotificationsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids?: string[];

  /** Marks every one read. */
  @IsOptional()
  @IsBoolean()
  all?: boolean;
}

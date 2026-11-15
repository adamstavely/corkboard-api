import { IsBoolean, IsOptional } from 'class-validator';
import { OrgDto } from '../orgs/orgs.dto';

/** The signed-in user and the workspaces they belong to. */
export class MeDto {
  id!: string;
  name!: string;
  email!: string | null;
  orgs!: OrgDto[];
  /** The assistant puts its changes to them as suggestions to accept, instead of making them. */
  assistantAsksFirst!: boolean;
}

export class UpdateMeDto {
  @IsOptional()
  @IsBoolean()
  assistantAsksFirst?: boolean;
}

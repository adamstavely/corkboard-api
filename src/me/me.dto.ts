import { OrgDto } from '../orgs/orgs.dto';

/** The signed-in user and the workspaces they belong to. */
export class MeDto {
  id!: string;
  name!: string;
  email!: string | null;
  orgs!: OrgDto[];
}

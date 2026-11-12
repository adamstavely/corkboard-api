import { ApiProperty } from '@nestjs/swagger';
import { ROLES } from '../access/roles';
import type { OrgRole } from '../db/schema';

/** A workspace the user belongs to. */
export class OrgDto {
  id!: string;
  name!: string;
  @ApiProperty({ enum: ROLES })
  role!: OrgRole;
}

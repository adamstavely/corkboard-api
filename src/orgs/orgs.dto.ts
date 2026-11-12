import { ApiProperty } from '@nestjs/swagger';
import type { OrgRole } from '../db/schema';

/** A workspace the user belongs to. */
export class OrgDto {
  id!: string;
  name!: string;
  @ApiProperty({ enum: ['admin', 'member'] })
  role!: OrgRole;
}

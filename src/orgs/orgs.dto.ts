import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { ROLES } from '../access/roles';
import type { OrgRole } from '../db/schema';

/** A workspace the user belongs to. */
export class OrgDto {
  id!: string;
  name!: string;
  @ApiProperty({ enum: ROLES })
  role!: OrgRole;
}

/** A workspace's name: what a new one is called, or what one is renamed to. */
export class NameOrgDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 80)
  name!: string;
}

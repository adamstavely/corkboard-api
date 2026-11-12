import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, MaxLength } from 'class-validator';
import { ROLES } from '../access/roles';
import type { OrgRole } from '../db/schema';


export class MemberDto {
  userId!: string;
  name!: string;
  email!: string | null;
  @ApiProperty({ enum: ROLES })
  role!: OrgRole;
}

/** An invite waiting for its person to sign in and accept it. */
export class InviteDto {
  id!: string;
  email!: string;
  @ApiProperty({ enum: ROLES })
  role!: OrgRole;
  invitedByName!: string | null;
  createdAt!: Date;
}

/** Who's in a workspace, and who's been invited. */
export class MembersDto {
  members!: MemberDto[];
  invites!: InviteDto[];
}

export class CreateInviteDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ enum: ROLES })
  @IsIn(ROLES)
  role!: OrgRole;
}

export class UpdateRoleDto {
  @ApiProperty({ enum: ROLES })
  @IsIn(ROLES)
  role!: OrgRole;
}

/** An invite to the signed-in person, as they see it. */
export class MyInviteDto {
  id!: string;
  orgId!: string;
  orgName!: string;
  @ApiProperty({ enum: ROLES })
  role!: OrgRole;
  invitedByName!: string | null;
}

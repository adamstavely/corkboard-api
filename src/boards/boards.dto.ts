import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { ROLES, type Role } from '../access/roles';
import type { BoardAccess, OrgRole } from '../db/schema';

const BOARD_ROLES = ['none', ...ROLES] as const satisfies readonly BoardAccess[];

export class BoardDto {
  id!: string;
  orgId!: string;
  title!: string;
  createdAt!: Date;
  updatedAt!: Date;
  /** What the person asking may do on this board. */
  @ApiProperty({ enum: ROLES })
  role!: Role;
}

export class CreateBoardDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;
}

export class UpdateBoardDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;
}

/** A board's content: its Yjs document encoded as a single update, in base64. Empty for a new board. */
export class BoardDocumentDto {
  state!: string;
}

/** Someone in the board's workspace, and what they may do on the board. */
export class BoardMemberDto {
  userId!: string;
  name!: string;
  email!: string | null;
  @ApiProperty({ enum: ROLES })
  workspaceRole!: OrgRole;
  /** Set on this board, replacing the workspace role; null when it follows the workspace. */
  @ApiProperty({ enum: BOARD_ROLES, nullable: true, type: String })
  boardRole!: BoardAccess | null;
  /** What they may do here; null when they can't open the board. */
  @ApiProperty({ enum: ROLES, nullable: true, type: String })
  role!: Role | null;
}

export class SetBoardRoleDto {
  /** A role for this board only (`none` keeps them out), or null to follow their workspace role. */
  @ApiProperty({ enum: BOARD_ROLES, nullable: true, type: String })
  @ValidateIf((o: SetBoardRoleDto) => o.role !== null)
  @IsIn(BOARD_ROLES)
  role!: BoardAccess | null;
}

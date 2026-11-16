import type { NoteColor } from '../assist/board-edit';
import type { StepActivityDto } from '../facilitation/facilitation.dto';
import type { ArrowDash, ArrowRoute, BoardView, FrameBorder, FrameFill, FrameLook, ShapeKind, TextSize } from './layout';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { type TemplateCategory } from './templates';
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
  /** The workspace folder it's filed in, if any. */
  folderId!: string | null;
  /** Whether the person asking starred it, and when they last opened it. */
  starred!: boolean;
  lastVisitedAt!: Date | null;
  /** The board this one carries on from, if it was started as its next session. */
  continuesId!: string | null;
}

export class NextSessionDto {
  /** The new board's title; by default the last one's, numbered up ("Sprint 13 retro"). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;
}

export class CreateBoardDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  /** A template to start from (see GET /board-templates, or one the workspace saved); without one, a blank board. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  template?: string;
}

export class TemplateFrameDto {
  key?: string;
  title!: string;
  x!: number;
  y!: number;
  w!: number;
  h!: number;
  fill?: FrameFill;
  border?: FrameBorder;
  look?: FrameLook;
}

export class TemplateNoteDto {
  key?: string;
  /** A line a paragraph; `**Bold:**` at a line's start is bold. */
  text!: string;
  /**
   * The note's rich text as written, from a saved board, used instead of `text` when given: each element
   * `{ n: name, a?: attributes, c?: children }`, each run of text `{ t: delta }` (Yjs XmlText delta, with its marks).
   */
  @ApiPropertyOptional({ type: 'array', items: { type: 'object', additionalProperties: true } })
  rich?: Record<string, unknown>[];
  color?: NoteColor;
  x!: number;
  y!: number;
  /** Its size, when not the usual one. */
  w?: number;
  h?: number;
}

export class TemplateTextDto {
  key?: string;
  text!: string;
  size?: TextSize;
  x!: number;
  y!: number;
  w?: number;
}

export class TemplateShapeDto {
  key?: string;
  shape!: ShapeKind;
  color?: NoteColor;
  label?: string;
  x!: number;
  y!: number;
  w!: number;
  h!: number;
}

export class TemplateTableDto {
  key?: string;
  x!: number;
  y!: number;
  rows?: number;
  cols?: number;
  /** cells[row][col]. */
  cells!: string[][];
  colWidth?: number;
}

export class TemplateViewDto {
  key?: string;
  view!: BoardView;
  x!: number;
  y!: number;
}

export class TemplateArrowDto {
  /** Keys of things in the layout. */
  from!: string;
  to!: string;
  route?: ArrowRoute;
  dash?: ArrowDash;
  weight?: number;
}

/** Things to lay out, in board pixels from the layout's top-left corner (corkboard-api's boards/layout.ts). */
export class TemplateLayoutDto {
  frames?: TemplateFrameDto[];
  notes?: TemplateNoteDto[];
  texts?: TemplateTextDto[];
  shapes?: TemplateShapeDto[];
  tables?: TemplateTableDto[];
  views?: TemplateViewDto[];
  arrows?: TemplateArrowDto[];
}

/** A frame's outline in a template's preview, in a 100-wide box. */
export class TemplatePreviewBoxDto {
  x!: number;
  y!: number;
  w!: number;
  h!: number;
}

/** A step of a template's agenda. */
export class TemplateAgendaStepDto {
  title!: string;
  minutes!: number;
  /** The key of the frame the step is about. */
  frame?: string;
  /** What the step runs when it starts. */
  activity?: StepActivityDto;
}

/** A board to start from, for the new-board picker and the board's own template picker. */
export class BoardTemplateDto {
  id!: string;
  name!: string;
  description!: string;
  category!: TemplateCategory;
  /** Its frames' titles, in order. */
  columns!: string[];
  preview!: TemplatePreviewBoxDto[];
  layout!: TemplateLayoutDto;
  /** How a session on it runs, if the template has a plan for one. */
  agenda?: TemplateAgendaStepDto[];
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

import { ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ROLES, type Role } from '../access/roles';
import { NOTE_COLORS, type NoteColor } from '../assist/board-edit';
import { MAX_DIAGRAM_CHARS } from '../assist/diagram-node';

/** The most an agent may propose at once. */
export const MAX_PROPOSED_NOTES = 50;
export const MAX_PROPOSED_FRAMES = 12;
export const MAX_PROPOSED_TASKS = 30;

/** A board the token's owner can open. */
export class AgentBoardDto {
  id!: string;
  title!: string;
  workspaceId!: string;
  workspace!: string;
  /** The owner's role on it: readers can read, commenters also comment, updaters and owners also propose changes. */
  @ApiProperty({ enum: ROLES })
  role!: Role;
  /** ISO time. */
  updatedAt!: string;
}

export class OutlineNoteDto {
  id!: string;
  text!: string;
  color!: string;
  /** Dot votes, when it has any. */
  votes?: number;
}

export class OutlineFrameDto {
  id!: string;
  title!: string;
  /** The notes inside it, top to bottom, left to right. */
  notes!: OutlineNoteDto[];
}

/** Anything else on the board, with whatever text it has. */
export class OutlineItemDto {
  id!: string;
  /** "text", "shape", "diagram", "app", "image", "file", "table"… */
  kind!: string;
  text!: string;
}

export class OutlineTaskDto {
  key!: string;
  title!: string;
  @ApiProperty({ enum: ['todo', 'doing', 'done'] })
  status!: 'todo' | 'doing' | 'done';
  /** 0 none · 1 low · 2 medium · 3 high · 4 urgent */
  priority!: number;
  /** The person it's assigned to, by name. */
  assignee?: string;
  /** "YYYY-MM-DD". */
  due?: string;
  /** The note it came from. */
  noteId?: string;
}

/** A board as an outline: frames with their notes, the notes outside frames, everything else by kind, and its tasks. */
export class BoardOutlineDto {
  id!: string;
  title!: string;
  workspace!: string;
  @ApiProperty({ enum: ROLES })
  role!: Role;
  /** Whether the token's owner may propose changes here (updaters and owners). */
  canPropose!: boolean;
  frames!: OutlineFrameDto[];
  /** Notes in no frame. */
  notes!: OutlineNoteDto[];
  /** Everything else, by kind: { "diagram": [...], "text": [...] }. */
  @ApiProperty({ type: 'object', additionalProperties: { type: 'array', items: { $ref: getSchemaPath('OutlineItemDto') } } })
  items!: Record<string, OutlineItemDto[]>;
  tasks!: OutlineTaskDto[];
  /** Suggestions waiting for someone to accept or turn down. */
  pendingSuggestions!: number;
  /** True when the board had more notes than an outline holds (1000), and the rest were left out. */
  truncated!: boolean;
}

export class AgentSearchQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  q!: string;
}

/** A board that matches a search, with matching passages as plain text. */
export class AgentSearchHitDto {
  boardId!: string;
  title!: string;
  workspace!: string;
  /** ISO time. */
  updatedAt!: string;
  snippets!: string[];
}

export class ProposedNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  text!: string;

  @IsOptional()
  @IsIn(NOTE_COLORS)
  @ApiProperty({ enum: NOTE_COLORS, required: false })
  color?: NoteColor;

  /** An existing frame to put it in (an id from the outline); without it, the note goes beside the board. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  frameId?: string;
}

export class ProposedFrameNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  text!: string;

  @IsOptional()
  @IsIn(NOTE_COLORS)
  @ApiProperty({ enum: NOTE_COLORS, required: false })
  color?: NoteColor;
}

/** A new frame, holding existing notes moved into it and new notes written in it. */
export class ProposedFrameDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  /** Existing notes to move into it, by id. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  noteIds?: string[];

  /** New notes to write in it. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PROPOSED_NOTES)
  @ValidateNested({ each: true })
  @Type(() => ProposedFrameNoteDto)
  notes?: ProposedFrameNoteDto[];
}

export class ProposedTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title!: string;

  /** A board member's name; someone who isn't one keeps their name in the title. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  owner?: string;

  /** "YYYY-MM-DD". */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  due?: string;

  /** 0 none · 1 low · 2 medium · 3 high · 4 urgent */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4)
  priority?: number;

  /** The note it comes from. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  noteId?: string;
}

/**
 * Changes to put to the board's people as one suggestion: nothing changes until an updater or owner accepts it.
 * Give at least one of notes, frames, tasks or diagram.
 */
export class ProposeChangesDto {
  /** Why, or what was asked, in a line: shown on the suggestion. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  summary?: string;

  /** New notes, beside the board or in an existing frame. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PROPOSED_NOTES)
  @ValidateNested({ each: true })
  @Type(() => ProposedNoteDto)
  notes?: ProposedNoteDto[];

  /** New frames, grouping existing notes and new ones. A frame all of whose notes move into new ones is removed. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PROPOSED_FRAMES)
  @ValidateNested({ each: true })
  @Type(() => ProposedFrameDto)
  frames?: ProposedFrameDto[];

  /** New tasks on the board's kanban. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PROPOSED_TASKS)
  @ValidateNested({ each: true })
  @Type(() => ProposedTaskDto)
  tasks?: ProposedTaskDto[];

  /** A Mermaid flowchart or sequence diagram, drawn beside the board. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DIAGRAM_CHARS)
  diagram?: string;
}

export class ProposalDto {
  /** The suggestion on the board, waiting for someone to accept or turn down. */
  suggestionId!: string;
  /** What it would do: "Would add 4 notes." */
  action!: string;
}

export class AgentCommentDto {
  /** The note, frame or other item to comment on (an id from the outline). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  itemId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body!: string;
}

export class AgentCommentResultDto {
  threadId!: string;
  commentId!: string;
}

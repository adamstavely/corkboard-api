import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, Max, Min, ValidateIf } from 'class-validator';
import { WHO, WHO_MANAGING, type PolicyWho } from './rules';

/** What a workspace's owners allow on its boards. */
export class PoliciesDto {
  /** Who may give people in the workspace a role on a board. */
  @ApiProperty({ enum: WHO_MANAGING })
  @IsIn(WHO_MANAGING)
  shareWithPeople!: PolicyWho;

  /** Who may make, change and turn off share links. */
  @ApiProperty({ enum: WHO_MANAGING })
  @IsIn(WHO_MANAGING)
  shareLinks!: PolicyWho;

  /** Share links may let guests edit. Off: editable links already made open read-only. */
  @IsBoolean()
  editableLinks!: boolean;

  /** Share links need a password, which guests type to open them. On: links without one stop opening. */
  @IsBoolean()
  linkPassword!: boolean;

  /** Share links expire within this many days; null for no limit. Links that would outlive it are cut short. */
  @ApiProperty({ type: Number, nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(365)
  linkMaxDays!: number | null;

  /** Who may export a board: image, PDF, Markdown, CSV, or tasks sent to a tracker. */
  @ApiProperty({ enum: WHO })
  @IsIn(WHO)
  exports!: PolicyWho;

  /** Who may open a board for outside feedback; board owners includes the facilitator. */
  @ApiProperty({ enum: WHO_MANAGING })
  @IsIn(WHO_MANAGING)
  feedback!: PolicyWho;

  /** Keep board history, saved versions and the assistant's undo list this many days; null keeps them for good. */
  @ApiProperty({ type: Number, nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(3650)
  retentionDays!: number | null;
}

/** Whether the person asking may do something, and if not, why. */
export class AllowedDto {
  allowed!: boolean;
  /** The policy's (or role's) reason, when not allowed. */
  reason!: string | null;
}

/** What the workspace's policies let the person asking do on one board. */
export class BoardPolicyDto {
  shareWithPeople!: AllowedDto;
  shareLinks!: AllowedDto;
  /** Make share links that let guests edit. */
  editableLinks!: AllowedDto;
  exports!: AllowedDto;
  feedback!: AllowedDto;
  /** New share links need a password. */
  linkPassword!: boolean;
  /** New share links must expire within this many days; null for no limit. */
  @ApiProperty({ type: Number, nullable: true })
  linkMaxDays!: number | null;
}

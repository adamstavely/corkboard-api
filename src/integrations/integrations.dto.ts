import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { INTEGRATION_KINDS, type IntegrationKind } from './exporters';

export class IntegrationConfigDto {
  /** GitHub: the repository, "owner/name". */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  repo?: string;

  /** Linear: the team's id. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  teamId?: string;

  /** Jira: the site, project key, and the email the token belongs to. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  projectKey?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

export class CreateIntegrationDto {
  @ApiProperty({ enum: INTEGRATION_KINDS })
  @IsIn(INTEGRATION_KINDS)
  kind!: IntegrationKind;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label!: string;

  @ValidateNested()
  @Type(() => IntegrationConfigDto)
  config!: IntegrationConfigDto;

  /** A personal access token or API key; stored encrypted and never shown again. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  token!: string;
}

/** A connection to an issue tracker, without its token. */
export class IntegrationDto {
  id!: string;
  @ApiProperty({ enum: INTEGRATION_KINDS })
  kind!: IntegrationKind;
  label!: string;
  config!: IntegrationConfigDto;
  /** Where issues go, in words: "acme/web", "Linear team", "ENG on acme.atlassian.net". */
  target!: string;
}

export class ExportTasksDto {
  @IsUUID()
  integrationId!: string;

  /** Which tasks; by default, every one not done and not sent before. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  taskIds?: string[];
}

export class ExportedTaskDto {
  taskId!: string;
  /** The task's key on the board (T-3) and the issue's in the tracker. */
  taskKey!: string;
  issueKey!: string;
  url!: string;
}

export class ExportFailureDto {
  taskId!: string;
  taskKey!: string;
  reason!: string;
}

export class ExportResultDto {
  exported!: ExportedTaskDto[];
  failed!: ExportFailureDto[];
  /** Tasks left out because they'd been sent before. */
  skipped!: number;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, IsUrl, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import type { ProviderKind } from '../db/schema';

const KINDS = ['anthropic', 'openai'] as const;

/** One of the site's AI connections, as people see it: never the key itself, only whether there is one. */
export class ProviderDto {
  id!: string;
  label!: string;
  @ApiProperty({ enum: KINDS })
  kind!: ProviderKind;
  model!: string;
  baseUrl!: string | null;
  hasKey!: boolean;
  /** What the site pays per million input and output tokens, if a site admin has said. */
  priceInPerMillion!: number | null;
  priceOutPerMillion!: number | null;
  createdAt!: Date;
}

/** A site connection as a workspace's owners choose: whether the workspace has it switched on for its people. */
export class WorkspaceModelDto extends ProviderDto {
  enabled!: boolean;
}

/** Switch a site connection on or off for a workspace. */
export class EnableModelDto {
  @IsBoolean()
  enabled!: boolean;
}

export class CreateProviderDto {
  /** What people see in the model picker, e.g. "Claude" or "Llama on our GPU box". */
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label!: string;

  @ApiProperty({ enum: KINDS })
  @IsIn(KINDS)
  kind!: ProviderKind;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  model!: string;

  /** Required for OpenAI-compatible servers; for Anthropic, only to go through a proxy. */
  @ValidateIf((o: CreateProviderDto) => o.kind === 'openai' || !!o.baseUrl)
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  baseUrl?: string | null;

  /** Stored encrypted; omit for servers that need none (a local Ollama). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;

  /** Prices per million tokens, for estimating spend; null clears one. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(0)
  @Max(10_000)
  priceInPerMillion?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(0)
  @Max(10_000)
  priceOutPerMillion?: number | null;
}

/** Fields left out stay as they are. An empty apiKey removes the stored key. */
export class UpdateProviderDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  model?: string;

  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;

  /** Prices per million tokens, for estimating spend; null clears one. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(0)
  @Max(10_000)
  priceInPerMillion?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(0)
  @Max(10_000)
  priceOutPerMillion?: number | null;
}

const HEALTH = ['healthy', 'auth-failed', 'model-unavailable', 'unreachable', 'error'] as const;

export class ProviderTestDto {
  ok!: boolean;
  /** What the test found: it works, or which part is at fault. */
  @ApiProperty({ enum: HEALTH })
  status!: (typeof HEALTH)[number];
  /** The model's reply, or what went wrong. */
  message!: string;
  latencyMs!: number;
}

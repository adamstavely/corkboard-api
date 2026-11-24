import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/** A logo: its viewBox and its drawing, as plain SVG markup. */
export class LogoDto {
  vb!: string;
  body!: string;
}

/** A workspace's logo pack, with its logos by name. */
export class LogoPackDto {
  /** The `<pack>` in `logo:<pack>/<logo>`. */
  name!: string;
  /** The vendor's terms, as given with its download. */
  licence?: string | null;
  @ApiProperty({ type: 'object', additionalProperties: { $ref: '#/components/schemas/LogoDto' } })
  logos!: Record<string, LogoDto>;
}

/** Logos to add to a pack (made if it's new), up to 2 MB a request: send a big pack in batches. */
export class AddLogosDto {
  @ApiProperty({ type: 'object', additionalProperties: { $ref: '#/components/schemas/LogoDto' } })
  @IsObject()
  logos!: Record<string, LogoDto>;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  licence?: string;
}

/** A logo that wasn't kept, and why. */
export class RefusedLogoDto {
  name!: string;
  reason!: string;
}

export class AddedLogosDto {
  name!: string;
  added!: number;
  total!: number;
  refused!: RefusedLogoDto[];
}

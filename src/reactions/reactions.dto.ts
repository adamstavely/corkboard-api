import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsString, MaxLength } from 'class-validator';
import { REACTIONS } from './reactions';

export class ReactDto {
  /** A note or frame on the board. */
  @IsString()
  @MaxLength(64)
  nodeId!: string;

  @ApiProperty({ enum: REACTIONS })
  @IsIn(REACTIONS)
  emoji!: string;

  /** Reacts, or takes the reaction back. */
  @IsBoolean()
  on!: boolean;
}

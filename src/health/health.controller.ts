import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { Public } from '../auth/auth.guard';
import { InjectDb, type Db } from '../db/db.module';
import { HealthDto } from './health.dto';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectDb() private readonly db: Db) {}

  /** Ready when Postgres answers. */
  @Public()
  @Get()
  async health(): Promise<HealthDto> {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
    return { status: 'ok' };
  }
}

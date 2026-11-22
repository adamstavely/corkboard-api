import { Controller, HttpCode, Param, ParseUUIDPipe, Post, Req, UnauthorizedException, type RawBodyRequest } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/auth.guard';
import { TrackerSyncService } from './tracker-sync.service';

/**
 * Where GitHub, Linear and Jira say an issue changed. No sign-in: each is checked against its connection's webhook
 * secret instead, and only brings that board's sync forward (the issue is read back from the tracker).
 */
@ApiExcludeController()
@Controller('hooks/trackers')
export class TrackerWebhooksController {
  constructor(private readonly sync: TrackerSyncService) {}

  @Public()
  @Post(':id')
  @HttpCode(202)
  async receive(@Param('id', ParseUUIDPipe) id: string, @Req() req: RawBodyRequest<Request>): Promise<void> {
    const refused = await this.sync.webhook(id, req.headers, req.rawBody, req.body);
    if (refused) throw new UnauthorizedException(refused);
  }
}

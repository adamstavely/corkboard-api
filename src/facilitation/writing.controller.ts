import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { NoteDraftDto, StartWritingDto, WriteDraftDto } from './writing.dto';
import { WritingService } from './writing.service';

/** What a reveal put on the board. */
export class RevealedDto {
  revealed!: number;
}

@ApiTags('facilitation')
@ApiBearerAuth()
@Controller('boards/:id/writing')
export class WritingController {
  constructor(private readonly writing: WritingService) {}

  /** Updaters and owners: start a hidden writing round. 409 if one is running. */
  @Post()
  @HttpCode(204)
  start(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: StartWritingDto): Promise<void> {
    return this.writing.start(user, id, body.anonymous, body.frameId);
  }

  /** Updaters and owners: put every note from the round on the board, and end it. */
  @Post('reveal')
  @HttpCode(200)
  reveal(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<RevealedDto> {
    return this.writing.reveal(user, id);
  }

  /** Updaters and owners: end the round without revealing; its notes are thrown away. */
  @Delete()
  @HttpCode(204)
  cancel(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.writing.cancel(user, id);
  }

  /** Commenters and up: your notes in the running round. Nobody else's. */
  @Get('drafts')
  mine(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<NoteDraftDto[]> {
    return this.writing.mine(user, id);
  }

  /** Commenters and up, while a round runs: write a hidden note. */
  @Post('drafts')
  write(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: WriteDraftDto): Promise<NoteDraftDto> {
    return this.writing.write(user, id, body.text, body.color);
  }

  @Patch('drafts/:draftId')
  edit(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Param('draftId', ParseUUIDPipe) draftId: string, @Body() body: WriteDraftDto): Promise<NoteDraftDto> {
    return this.writing.edit(user, id, draftId, body.text, body.color);
  }

  @Delete('drafts/:draftId')
  @HttpCode(204)
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Param('draftId', ParseUUIDPipe) draftId: string): Promise<void> {
    return this.writing.remove(user, id, draftId);
  }
}

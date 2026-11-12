import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { AssistRequestDto, AssistResultDto } from './assist.dto';
import { AssistService } from './assist.service';

@ApiTags('assist')
@ApiBearerAuth()
@Controller('boards/:id/assist')
export class AssistController {
  constructor(private readonly assistant: AssistService) {}

  /**
   * Asks one of the workspace's models about the board (or the selected notes), letting it add and recolour notes.
   * Answers 502 with the model's problem in plain words when the model fails.
   */
  @Post()
  @HttpCode(200)
  assist(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AssistRequestDto,
  ): Promise<AssistResultDto> {
    return this.assistant.assist(user, id, body);
  }
}

import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { ChatMessageDto, SendChatDto } from './chat.dto';
import { ChatService } from './chat.service';

@ApiTags('chat')
@ApiBearerAuth()
@Controller('boards/:id/chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /**
   * Commenters and up: say something in the board's chat, which everyone on the board reads live from its document.
   * With `answer`, the model then answers in the chat too, as this person (their role, their selection).
   */
  @Post()
  send(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: SendChatDto): Promise<ChatMessageDto> {
    return this.chat.send(user, id, body);
  }
}

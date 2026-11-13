import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { AssistController } from './assist/assist.controller';
import { AssistService } from './assist/assist.service';
import { ChatController } from './chat/chat.controller';
import { ChatService } from './chat/chat.service';
import { CommentsController } from './comments/comments.controller';
import { CommentsService } from './comments/comments.service';
import { AuthGuard } from './auth/auth.guard';
import { PeopleController } from './auth/people.controller';
import { UsersService } from './auth/users.service';
import { BoardsController } from './boards/boards.controller';
import { BoardsService } from './boards/boards.service';
import { CollabService } from './collab/collab.service';
import configuration from './config/configuration';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { MeController } from './me/me.controller';
import { CHAT_MODELS, chatModelFor } from './models/chat-models';
import { ProvidersController } from './models/providers.controller';
import { ProvidersService } from './models/providers.service';
import { SecretBox } from './models/secret-box';
import { MembersController } from './orgs/members.controller';
import { MembersService } from './orgs/members.service';
import { OrgsService } from './orgs/orgs.service';
import { SearchController } from './search/search.controller';
import { SearchIndex } from './search/search-index';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration] }), DbModule],
  controllers: [
    ChatController,
    CommentsController,
    HealthController,
    PeopleController,
    MeController,
    BoardsController,
    SearchController,
    MembersController,
    ProvidersController,
    AssistController,
  ],
  providers: [
    UsersService,
    OrgsService,
    MembersService,
    SecretBox,
    { provide: CHAT_MODELS, useValue: chatModelFor },
    ProvidersService,
    AssistService,
    CommentsService,
    ChatService,
    BoardsService,
    SearchIndex,
    CollabService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_PIPE, useValue: new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }) },
  ],
})
export class AppModule {}

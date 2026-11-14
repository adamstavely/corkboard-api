import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { AssistController } from './assist/assist.controller';
import { AssistService } from './assist/assist.service';
import { ChatController } from './chat/chat.controller';
import { FacilitationController } from './facilitation/facilitation.controller';
import { OrganiseController } from './organise/organise.controller';
import { OrganiseService } from './organise/organise.service';
import { LinksController } from './links/links.controller';
import { LinksService } from './links/links.service';
import { ActivityController } from './activity/activity.controller';
import { VersionsService } from './activity/activity';
import { ActivityService } from './activity/activity.service';
import { NotificationsController } from './activity/notifications.controller';
import { NotificationsService } from './activity/notifications';
import { NotificationHub } from './activity/notification-hub';
import { PasskeysController } from './auth/passkeys.controller';
import { PasskeysService } from './auth/passkeys.service';
import { FilesController } from './files/files.controller';
import { FilesService } from './files/files.service';
import { ReactionsController } from './reactions/reactions.controller';
import { ReactionsService } from './reactions/reactions';
import { SummaryController } from './summary/summary.controller';
import { SummaryService } from './summary/summary.service';
import { RecapController } from './summary/recap.controller';
import { RecapService } from './summary/recap.service';
import { WritingController } from './facilitation/writing.controller';
import { WritingService } from './facilitation/writing.service';
import { UnfurlController } from './unfurl/unfurl.controller';
import { IntegrationsController } from './integrations/integrations.controller';
import { IntegrationsService } from './integrations/integrations.service';
import { IssueHttp } from './integrations/issue-http';
import { LedgerController } from './ledger/ledger.controller';
import { LedgerService } from './ledger/ledger.service';
import { FacilitationService } from './facilitation/facilitation.service';
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
    FacilitationController,
    OrganiseController,
    LinksController,
    ActivityController,
    NotificationsController,
    PasskeysController,
    FilesController,
    ReactionsController,
    SummaryController,
    RecapController,
    WritingController,
    UnfurlController,
    IntegrationsController,
    LedgerController,
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
    FacilitationService,
    OrganiseService,
    LinksService,
    ActivityService,
    VersionsService,
    NotificationsService,
    NotificationHub,
    PasskeysService,
    FilesService,
    ReactionsService,
    SummaryService,
    RecapService,
    WritingService,
    IntegrationsService,
    IssueHttp,
    LedgerService,
    BoardsService,
    SearchIndex,
    CollabService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_PIPE, useValue: new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }) },
  ],
})
export class AppModule {}

import { type MiddlewareConsumer, Module, type NestModule, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { AssistController } from './assist/assist.controller';
import { AssistService } from './assist/assist.service';
import { ChatController } from './chat/chat.controller';
import { FacilitationController } from './facilitation/facilitation.controller';
import { OrganiseController } from './organise/organise.controller';
import { OrganiseService } from './organise/organise.service';
import { LinksController } from './links/links.controller';
import { FeedbackController } from './feedback/feedback.controller';
import { FeedbackService } from './feedback/feedback.service';
import { ParticipantsStore } from './feedback/participants.store';
import { ParticipationService } from './feedback/participation.service';
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
import { CatchUpService } from './summary/catchup.service';
import { RecapController } from './summary/recap.controller';
import { RecapService } from './summary/recap.service';
import { PokerController } from './facilitation/poker.controller';
import { SavedTemplatesController } from './boards/saved-templates.controller';
import { SavedTemplatesService } from './boards/saved-templates.service';
import { PokerService } from './facilitation/poker.service';
import { WritingController } from './facilitation/writing.controller';
import { WritingService } from './facilitation/writing.service';
import { DiagramImageController } from './unfurl/diagram-image.controller';
import { UnfurlController } from './unfurl/unfurl.controller';
import { fetchImage, IMAGE_FETCH } from './unfurl/unfurl';
import { IntegrationsController } from './integrations/integrations.controller';
import { IntegrationsService } from './integrations/integrations.service';
import { IssueHttp } from './integrations/issue-http';
import { TrackerSyncService } from './integrations/tracker-sync.service';
import { TrackerWebhooksController } from './integrations/tracker-webhooks.controller';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { LedgerController } from './ledger/ledger.controller';
import { LedgerService } from './ledger/ledger.service';
import { FacilitationService } from './facilitation/facilitation.service';
import { ChatService } from './chat/chat.service';
import { CommentsController } from './comments/comments.controller';
import { CommentsService } from './comments/comments.service';
import { AuthGuard } from './auth/auth.guard';
import { AgentsController } from './agents/agents.controller';
import { AgentsService } from './agents/agents.service';
import { McpController } from './agents/mcp.controller';
import { TokensController } from './tokens/tokens.controller';
import { TokensService } from './tokens/tokens.service';
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
import { AppsController } from './apps/apps.controller';
import { AppsService } from './apps/apps.service';
import { SuggestionsController } from './suggestions/suggestions.controller';
import { SuggestionsService } from './suggestions/suggestions.service';
import { ToolsController } from './web/tools.controller';
import { ToolsService } from './web/tools.service';
import { realWeb, WEB } from './web/web';
import { MembersController } from './orgs/members.controller';
import { MembersService } from './orgs/members.service';
import { OrgsService } from './orgs/orgs.service';
import { SearchController } from './search/search.controller';
import { SearchIndex } from './search/search-index';
import { PoliciesController } from './policies/policies.controller';
import { OembedController } from './embed/oembed.controller';
import { noFraming } from './embed/no-framing';
import { PoliciesService } from './policies/policies.service';
import { RetentionService } from './policies/retention.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration] }), DbModule],
  controllers: [
    ChatController,
    FacilitationController,
    OrganiseController,
    LinksController,
    FeedbackController,
    ActivityController,
    NotificationsController,
    PasskeysController,
    FilesController,
    ReactionsController,
    SummaryController,
    RecapController,
    WritingController,
    PokerController,
    SavedTemplatesController,
    UnfurlController,
    DiagramImageController,
    IntegrationsController,
    TrackerWebhooksController,
    AdminController,
    LedgerController,
    CommentsController,
    HealthController,
    PeopleController,
    MeController,
    BoardsController,
    SearchController,
    MembersController,
    ProvidersController,
    ToolsController,
    SuggestionsController,
    AppsController,
    AssistController,
    TokensController,
    AgentsController,
    McpController,
    PoliciesController,
    OembedController,
  ],
  providers: [
    UsersService,
    OrgsService,
    MembersService,
    SecretBox,
    { provide: CHAT_MODELS, useValue: chatModelFor },
    ProvidersService,
    ToolsService,
    SuggestionsService,
    AppsService,
    { provide: WEB, useFactory: () => realWeb() },
    { provide: IMAGE_FETCH, useValue: fetchImage },
    AssistService,
    CommentsService,
    ChatService,
    FacilitationService,
    OrganiseService,
    LinksService,
    FeedbackService,
    ParticipantsStore,
    ParticipationService,
    ActivityService,
    VersionsService,
    NotificationsService,
    NotificationHub,
    PasskeysService,
    FilesService,
    ReactionsService,
    SummaryService,
    CatchUpService,
    RecapService,
    WritingService,
    PokerService,
    SavedTemplatesService,
    IntegrationsService,
    IssueHttp,
    TrackerSyncService,
    AdminService,
    LedgerService,
    BoardsService,
    SearchIndex,
    CollabService,
    TokensService,
    AgentsService,
    PoliciesService,
    RetentionService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_PIPE, useValue: new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }) },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(noFraming).forRoutes('{*splat}');
  }
}

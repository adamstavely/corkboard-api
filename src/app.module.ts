import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard';
import { discoveredKeys, KEY_SOURCE, TokenVerifier } from './auth/token-verifier';
import { UsersService } from './auth/users.service';
import { BoardsController } from './boards/boards.controller';
import { BoardsService } from './boards/boards.service';
import { CollabService } from './collab/collab.service';
import configuration from './config/configuration';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { MeController } from './me/me.controller';
import { OrgsService } from './orgs/orgs.service';
import { SearchController } from './search/search.controller';
import { SearchIndex } from './search/search-index';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration] }), DbModule],
  controllers: [HealthController, MeController, BoardsController, SearchController],
  providers: [
    { provide: KEY_SOURCE, useValue: discoveredKeys },
    TokenVerifier,
    UsersService,
    OrgsService,
    BoardsService,
    SearchIndex,
    CollabService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_PIPE, useValue: new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }) },
  ],
})
export class AppModule {}

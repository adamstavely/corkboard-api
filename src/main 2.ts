import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import type { OidcConfig } from './config/configuration';
import { buildOpenApi } from './openapi';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  if (!config.getOrThrow<OidcConfig>('oidc').issuer) {
    throw new Error('OIDC_ISSUER is required (local dev: http://localhost:8280/realms/corkboard)');
  }
  // Board documents are sent whole until real-time sync arrives (see BoardsService.MAX_DOCUMENT_BYTES; base64 adds a third).
  app.useBodyParser('json', { limit: '15mb' });
  app.enableShutdownHooks();
  SwaggerModule.setup('docs', app, buildOpenApi(app), { jsonDocumentUrl: 'docs/openapi.json' });
  await app.listen(config.getOrThrow<number>('port'));
}

void bootstrap();

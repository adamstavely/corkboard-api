import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { buildOpenApi } from './openapi';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  const config = app.get(ConfigService);
  // Up to 2 MB of JSON: a workspace's logo pack goes up in batches that size.
  app.useBodyParser('json', { limit: '2mb' });
  app.enableShutdownHooks();
  SwaggerModule.setup('docs', app, buildOpenApi(app), { jsonDocumentUrl: 'docs/openapi.json' });
  await app.listen(config.getOrThrow<number>('port'));
}

void bootstrap();

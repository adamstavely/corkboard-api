import { Controller, Get, HttpException, HttpStatus, NotFoundException, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/auth.guard';
import type { AppConfig } from '../config/configuration';
import { LinksService } from '../links/links.service';
import { OembedDto, OembedQueryDto } from './oembed.dto';
import { embedIframe, embedSize, embedToken } from './oembed';

@ApiTags('embed')
@Controller()
export class OembedController {
  constructor(
    private readonly links: LinksService,
    private readonly config: ConfigService,
  ) {}

  /**
   * oEmbed (https://oembed.com) for embed pages, so Notion's /embed block, Confluence's iframe macro and the like show
   * the board live: a "rich" answer with an iframe. The url must be an embed page on Corkboard's own address. 404 for
   * any other; 403 naming the policy when the workspace turns embeds off or the link has a password; 410 once it's
   * turned off or expired; 501 for formats other than json.
   */
  @Public()
  @Get('oembed')
  async oembed(@Query() query: OembedQueryDto): Promise<OembedDto> {
    if (query.format && query.format !== 'json') throw new HttpException('Only the json format is offered', HttpStatus.NOT_IMPLEMENTED);
    const origins = this.config.getOrThrow<AppConfig['webauthn']>('webauthn').origins;
    const token = embedToken(query.url, origins);
    if (!token) throw new NotFoundException("That isn't a Corkboard embed page");
    const { title } = await this.links.admitEmbed(token);
    const size = embedSize(query.maxwidth, query.maxheight);
    const origin = new URL(query.url).origin;
    return {
      version: '1.0',
      type: 'rich',
      title,
      provider_name: 'Corkboard',
      provider_url: origin,
      html: embedIframe(`${origin}/embed/${token}`, title, size),
      ...size,
      // Short: a revoked link should stop showing soon in consumers that cache.
      cache_age: 300,
    };
  }
}

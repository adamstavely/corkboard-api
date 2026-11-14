import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LinkPreviewDto, UnfurlRequestDto } from './unfurl.dto';
import { unfurl } from './unfurl';

@ApiTags('boards')
@ApiBearerAuth()
@Controller('link-preview')
export class UnfurlController {
  /** Anyone signed in: the title, description and picture of a public web page, for a link card. */
  @Post()
  @HttpCode(200)
  async preview(@Body() body: UnfurlRequestDto): Promise<LinkPreviewDto> {
    try {
      return await unfurl(body.url);
    } catch (err) {
      throw new BadRequestException(`That link couldn't be previewed: ${(err as Error).message}`);
    }
  }
}

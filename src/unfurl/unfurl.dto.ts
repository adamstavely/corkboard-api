import { IsUrl, MaxLength } from 'class-validator';

export class UnfurlRequestDto {
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2000)
  url!: string;
}

/** What a link card on the board shows. */
export class LinkPreviewDto {
  url!: string;
  title!: string;
  description!: string;
  image!: string | null;
  site!: string;
}

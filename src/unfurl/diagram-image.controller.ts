import {
  BadRequestException,
  Body,
  Controller,
  GoneException,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiProduces,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import * as Y from "yjs";
import { diagramImageUrls, diagramsOn } from "../assist/diagram-node";
import { Public } from "../auth/auth.guard";
import { BoardsService } from "../boards/boards.service";
import { CollabService } from "../collab/collab.service";
import { PASS_HEADER } from "../links/links.controller";
import { LinksService } from "../links/links.service";
import { DiagramImageRequestDto } from "./diagram-image.dto";
import { IMAGE_FETCH, type ImageFetch } from "./unfurl";

/**
 * Pictures for diagrams. A diagram is drawn as an image, which can't load anything itself, so the page fetches each
 * picture first and puts it inside; pictures on the web come through here, fetched as link previews are (never from a
 * private address), checked to be a picture by their own bytes, and no bigger than 1 MB.
 */
@ApiTags("boards")
@ApiBearerAuth()
@Controller()
export class DiagramImageController {
  constructor(
    private readonly links: LinksService,
    private readonly boards: BoardsService,
    private readonly collab: CollabService,
    @Inject(IMAGE_FETCH) private readonly fetchImage: ImageFetch,
  ) {}

  /** Anyone signed in: a picture from a public https address, for a diagram. */
  @Post("diagram-image")
  @HttpCode(200)
  @ApiProduces("image/png", "image/jpeg", "image/gif", "image/webp")
  async image(
    @Body() body: DiagramImageRequestDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.#send(body.url, res);
  }

  /** Anyone with a link: a picture that a diagram on the board it opens shows, while the link is live (410 after). */
  @Public()
  @Post("shared/:token/diagram-image")
  @HttpCode(200)
  @ApiHeader({
    name: PASS_HEADER,
    required: false,
    description: "Proof of the link's password, from unlock",
  })
  @ApiProduces("image/png", "image/jpeg", "image/gif", "image/webp")
  async shared(
    @Param("token") token: string,
    @Body() body: DiagramImageRequestDto,
    @Headers(PASS_HEADER) pass: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    // A link with a password needs proof it was typed; one that's gone or never was is simply gone.
    const { link } = await this.links
      .admit(token, pass)
      .catch((err: unknown) => {
        throw err instanceof NotFoundException
          ? new GoneException("This link has been turned off or has expired")
          : err;
      });
    // A guest only gets the pictures the board's diagrams show, so a link isn't a way to fetch anything at all.
    const shown = diagramsOn(await this.#doc(link.boardId)).some((d) =>
      diagramImageUrls(d.source).includes(body.url),
    );
    if (!shown)
      throw new NotFoundException(
        "That picture isn't in a diagram on this board",
      );
    await this.#send(body.url, res);
  }

  /** The board as it is now: live if anyone has it open, else as last saved. */
  async #doc(boardId: string): Promise<Y.Doc> {
    const doc = new Y.Doc();
    const live = this.collab.hocuspocus.documents.get(boardId) as unknown as
      Y.Doc | undefined;
    const state = live
      ? Y.encodeStateAsUpdate(live)
      : await this.boards.loadState(boardId);
    if (state?.length) Y.applyUpdate(doc, new Uint8Array(state));
    return doc;
  }

  async #send(url: string, res: Response): Promise<void> {
    let image: { type: string; data: Buffer };
    try {
      image = await this.fetchImage(url);
    } catch (err) {
      throw new BadRequestException(
        `That picture couldn't be fetched: ${(err as Error).message}`,
      );
    }
    res.setHeader("Content-Type", image.type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(image.data);
  }
}

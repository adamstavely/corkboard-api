import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user';
import type { User } from '../db/schema';
import { AskImageDto, BoardFileDto, ImageAnswerDto } from './files.dto';
import { FilesService, isImage, MAX_FILE_BYTES, type Upload } from './files.service';

@ApiTags('files')
@ApiBearerAuth()
@Controller('boards/:id/files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** Updaters and owners: add an image or file (up to 10 MB) to the board; place it with the returned id. */
  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES + 1 } }))
  upload(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Upload | undefined): Promise<BoardFileDto> {
    return this.files.upload(user, id, file);
  }

  /** Anyone who can open the board: the file itself. Images and PDFs open in place; other files download. */
  @Get(':fileId')
  @ApiProduces('application/octet-stream')
  async download(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.files.get(user, id, fileId);
    const inline = isImage(file.mime) || file.mime === 'application/pdf';
    res.set({
      'Content-Type': file.mime,
      'Content-Length': String(file.data.length),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
    res.send(file.data);
  }

  /** Commenters and up: ask one of the workspace's models about an image on the board, and places marked on it. */
  @Post(':fileId/ask')
  @HttpCode(200)
  ask(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() body: AskImageDto,
  ): Promise<ImageAnswerDto> {
    return this.files.ask(user, id, fileId, body);
  }
}

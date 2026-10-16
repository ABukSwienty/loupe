import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import { resolve } from 'node:path';
import type { Response } from 'express';
import { YtDlpError } from '../../infra/yt-dlp/yt-dlp.service.js';
import { parsePageQuery, type Page } from '../../common/pagination.js';
import type { Video, VideoSummary } from './video.model.js';
import {
  InvalidVideoUrlError,
  UnsupportedVideoError,
  VideosService,
} from './videos.service.js';

@Controller('videos')
export class VideosController {
  constructor(private readonly videos: VideosService) {}

  /**
   * Ingests a YouTube video: stores its metadata now and downloads a
   * low-resolution copy in the background. Responds 201 for a new video and
   * 200 for one already ingested; `jobId` is set when a download was queued.
   */
  @Post()
  async ingest(
    @Body() body: { url?: unknown },
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ video: Video; jobId: string | null }> {
    if (typeof body?.url !== 'string') {
      throw new BadRequestException('url must be a string');
    }

    // Stops yt-dlp if the client goes away before the metadata arrives.
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableFinished) controller.abort();
    };
    res.on('close', onClose);

    try {
      const { video, created, jobId } = await this.videos.ingest(body.url, {
        signal: controller.signal,
      });
      res.status(created ? 201 : 200);
      return { video, jobId };
    } catch (err) {
      if (err instanceof InvalidVideoUrlError) {
        throw new BadRequestException(err.message);
      }
      if (err instanceof UnsupportedVideoError || err instanceof YtDlpError) {
        throw new UnprocessableEntityException(err.message);
      }
      throw err;
    } finally {
      res.off('close', onClose);
    }
  }

  /** `?page=&pageSize=` (default 1 and 20, max 100). Newest first, without `metadata`. */
  @Get()
  findMany(
    @Query() query: Record<string, unknown>,
  ): Promise<Page<VideoSummary>> {
    return this.videos.findMany(parsePageQuery(query));
  }

  /**
   * The video file for playback: the low-res copy, or the original. Supports
   * HTTP range requests, which browsers need to seek.
   */
  @Get(':id/media')
  async media(@Param('id') id: string, @Res() res: Response) {
    const video = await this.videos.findOne(id);
    if (!video) throw new NotFoundException();
    const path = video.lowResPath ?? video.filePath;
    if (!path) throw new NotFoundException('Video has not been downloaded');
    res.sendFile(resolve(path), (err) => {
      // Seeking aborts requests mid-stream; only report a missing file.
      if (err && !res.headersSent) {
        res
          .status(404)
          .json({ message: 'Video file is missing', statusCode: 404 });
      }
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Video> {
    const video = await this.videos.findOne(id);
    if (!video) throw new NotFoundException();
    return video;
  }
}

import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  Query,
} from '@nestjs/common';
import { found, requireVideo } from '../../common/results.js';
import { ROUTES } from '../../common/routes.js';
import { VideosService } from '../videos/videos.service.js';
import { TRANSCRIBER, type Transcriber } from './interface.js';
import type {
  Transcription,
  TranscriptionChunk,
} from './transcription.model.js';

/** 404 for an unknown video, and 404 "transcribe has not run" without a result. Times are seconds. */
@Controller(ROUTES.transcription.base)
export class TranscriptionController {
  constructor(
    @Inject(TRANSCRIBER) private readonly transcriber: Transcriber,
    private readonly videos: VideosService,
  ) {}

  /** Segments with words. `?include=chunks` adds the 30-second chunks used for embeddings. */
  @Get(ROUTES.transcription.results)
  async results(
    @Param('videoId') videoId: string,
    @Query('include') include?: string,
  ): Promise<Transcription & { chunks?: TranscriptionChunk[] }> {
    if (include !== undefined && include !== 'chunks') {
      throw new BadRequestException("include must be 'chunks'");
    }
    await requireVideo(this.videos, videoId);
    return found(
      this.transcriber.transcription(videoId, {
        chunks: include === 'chunks',
      }),
      'transcribe',
    );
  }
}

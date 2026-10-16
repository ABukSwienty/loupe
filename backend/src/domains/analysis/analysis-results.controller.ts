import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { VideosService } from '../videos/videos.service.js';
import { AnalysisResultsService } from './analysis-results.service.js';
import type {
  AnalysisOverview,
  Diarization,
  OcrResult,
  SceneDetection,
  Transcription,
  TranscriptionChunk,
} from './analysis.model.js';

/**
 * Stored analysis results. Each responds 404 for an unknown video, and 404
 * with "<step> has not run" when the video has no result for that step.
 * Times are seconds into the video.
 */
@Controller('videos/:videoId')
export class AnalysisResultsController {
  constructor(
    private readonly results: AnalysisResultsService,
    private readonly videos: VideosService,
  ) {}

  /** Which steps have results, with counts and embedding coverage. */
  @Get('analysis')
  async overview(@Param('videoId') videoId: string): Promise<AnalysisOverview> {
    await this.requireVideo(videoId);
    return this.results.overview(videoId);
  }

  /** Segments with words. `?include=chunks` adds the 30-second chunks used for embeddings. */
  @Get('transcription')
  async transcription(
    @Param('videoId') videoId: string,
    @Query('include') include?: string,
  ): Promise<Transcription & { chunks?: TranscriptionChunk[] }> {
    if (include !== undefined && include !== 'chunks') {
      throw new BadRequestException("include must be 'chunks'");
    }
    await this.requireVideo(videoId);
    return found(
      this.results.transcription(videoId, { chunks: include === 'chunks' }),
      'transcribe',
    );
  }

  @Get('diarization')
  async diarization(@Param('videoId') videoId: string): Promise<Diarization> {
    await this.requireVideo(videoId);
    return found(this.results.diarization(videoId), 'diarize');
  }

  /** Scenes in order, each with a `keyframeUrl` for its JPEG. */
  @Get('scenes')
  async scenes(@Param('videoId') videoId: string): Promise<SceneDetection> {
    await this.requireVideo(videoId);
    return found(this.results.scenes(videoId), 'scenes');
  }

  @Get('scenes/:sceneId/keyframe')
  keyframe(
    @Param('videoId') videoId: string,
    @Param('sceneId') sceneId: string,
    @Res() res: Response,
  ) {
    const path = this.results.keyframePath(videoId, sceneId);
    if (!path) throw new NotFoundException('Keyframe not found');
    // The file is replaced, not edited, when scenes run again, under a new scene id.
    res.sendFile(
      path,
      { headers: { 'cache-control': 'private, max-age=31536000, immutable' } },
      (err) => {
        if (err && !res.headersSent) {
          res
            .status(404)
            .json({ message: 'Keyframe file is missing', statusCode: 404 });
        }
      },
    );
  }

  /** One result per OCR'd keyframe, in video order, with its lines. */
  @Get('ocr')
  async ocr(@Param('videoId') videoId: string): Promise<OcrResult[]> {
    await this.requireVideo(videoId);
    return found(this.results.ocr(videoId), 'ocr');
  }

  private async requireVideo(videoId: string) {
    if (!(await this.videos.findOne(videoId))) {
      throw new NotFoundException(`Video ${videoId} not found`);
    }
  }
}

function found<T>(result: T | null, step: string): T {
  if (result === null) throw new NotFoundException(`${step} has not run`);
  return result;
}

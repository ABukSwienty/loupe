import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AnalysisJobInputs, AnalysisStep } from './analysis.jobs.js';
import {
  AnalysisService,
  MissingPrerequisiteError,
  VideoNotFoundError,
} from './analysis.service.js';

type Body = Record<string, unknown> | undefined;

/**
 * One endpoint per analysis step. Each queues a job and responds 202 with its
 * id, or 200 with the id of the same step already queued for the video. Poll
 * GET /jobs/:id for the outcome.
 */
@Controller('videos/:videoId')
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  /** Body: `{ language?: string }`, an ISO code; omit to auto-detect. */
  @Post('transcribe')
  transcribe(
    @Param('videoId') videoId: string,
    @Body() body: Body,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.enqueue(res, 'transcribe', {
      videoId,
      language: optionalString(body, 'language'),
    });
  }

  /** Body: `{ numSpeakers?, minSpeakers?, maxSpeakers? }`, all optional. */
  @Post('diarize')
  diarize(
    @Param('videoId') videoId: string,
    @Body() body: Body,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.enqueue(res, 'diarize', {
      videoId,
      numSpeakers: optionalInt(body, 'numSpeakers', 1, 100),
      minSpeakers: optionalInt(body, 'minSpeakers', 1, 100),
      maxSpeakers: optionalInt(body, 'maxSpeakers', 1, 100),
    });
  }

  /**
   * Body: `{ detector?: 'adaptive' | 'content', threshold?: number,
   * keyframeWidth?: number }`. Defaults: adaptive, the detector's own
   * threshold, 512px keyframes.
   */
  @Post('scenes')
  scenes(
    @Param('videoId') videoId: string,
    @Body() body: Body,
    @Res({ passthrough: true }) res: Response,
  ) {
    const detector = body?.detector ?? 'adaptive';
    if (detector !== 'adaptive' && detector !== 'content') {
      throw new BadRequestException("detector must be 'adaptive' or 'content'");
    }
    return this.enqueue(res, 'scenes', {
      videoId,
      detector,
      threshold: optionalNumber(body, 'threshold'),
      keyframeWidth: optionalInt(body, 'keyframeWidth', 64, 1920) ?? 512,
    });
  }

  /** Reads text in the scene keyframes. Needs scenes. */
  @Post('ocr')
  ocr(
    @Param('videoId') videoId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.enqueue(res, 'ocr', { videoId });
  }

  /** Embeds the transcript chunks for text search. Needs a transcription. */
  @Post('embeddings/transcript')
  embedTranscript(
    @Param('videoId') videoId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.enqueue(res, 'embedTranscript', { videoId });
  }

  /** Embeds the scene keyframes for visual search. Needs scenes. */
  @Post('embeddings/scenes')
  embedScenes(
    @Param('videoId') videoId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.enqueue(res, 'embedScenes', { videoId });
  }

  private async enqueue<S extends AnalysisStep>(
    res: Response,
    step: S,
    input: AnalysisJobInputs[S],
  ): Promise<{ jobId: string }> {
    try {
      const { jobId, queued } = await this.analysis.enqueue(step, input);
      res.status(queued ? 202 : 200);
      return { jobId };
    } catch (err) {
      if (err instanceof VideoNotFoundError) {
        throw new NotFoundException(err.message);
      }
      if (err instanceof MissingPrerequisiteError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
  }
}

function optionalString(body: Body, key: string): string | null {
  const value = body?.[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value === '') {
    throw new BadRequestException(`${key} must be a non-empty string`);
  }
  return value;
}

function optionalNumber(body: Body, key: string): number | null {
  const value = body?.[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BadRequestException(`${key} must be a number`);
  }
  return value;
}

function optionalInt(
  body: Body,
  key: string,
  min: number,
  max: number,
): number | null {
  const value = optionalNumber(body, key);
  if (value === null) return null;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new BadRequestException(
      `${key} must be an integer from ${min} to ${max}`,
    );
  }
  return value;
}

import { Controller, Get, Inject, Param } from '@nestjs/common';
import { found, requireVideo } from '../../common/results.js';
import { ROUTES } from '../../common/routes.js';
import { VideosService } from '../videos/videos.service.js';
import type { Diarization } from './diarization.model.js';
import { DIARIZER, type Diarizer } from './interface.js';

/** 404 for an unknown video, and 404 "diarize has not run" without a result. Times are seconds. */
@Controller(ROUTES.diarization.base)
export class DiarizationController {
  constructor(
    @Inject(DIARIZER) private readonly diarizer: Diarizer,
    private readonly videos: VideosService,
  ) {}

  /** Speakers, overlapping `segments` and one-at-a-time `exclusiveSegments`. */
  @Get(ROUTES.diarization.results)
  async results(@Param('videoId') videoId: string): Promise<Diarization> {
    await requireVideo(this.videos, videoId);
    return found(this.diarizer.diarization(videoId), 'diarize');
  }
}

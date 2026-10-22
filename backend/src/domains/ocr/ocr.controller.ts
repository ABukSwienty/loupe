import { Controller, Get, Inject, Param } from '@nestjs/common';
import { found, requireVideo } from '../../common/results.js';
import { ROUTES } from '../../common/routes.js';
import { VideosService } from '../videos/videos.service.js';
import { OCR_READER, type OcrReader } from './interface.js';
import type { OcrResult } from './ocr.model.js';

/** 404 for an unknown video, and 404 "ocr has not run" without a result. Times are seconds. */
@Controller(ROUTES.ocr.base)
export class OcrController {
  constructor(
    @Inject(OCR_READER) private readonly reader: OcrReader,
    private readonly videos: VideosService,
  ) {}

  /** One result per OCR'd keyframe, in video order, with its lines. */
  @Get(ROUTES.ocr.results)
  async results(@Param('videoId') videoId: string): Promise<OcrResult[]> {
    await requireVideo(this.videos, videoId);
    return found(this.reader.results(videoId), 'ocr');
  }
}

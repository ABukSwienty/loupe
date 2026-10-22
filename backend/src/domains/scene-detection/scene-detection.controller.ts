import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { found, requireVideo } from '../../common/results.js';
import { ROUTES } from '../../common/routes.js';
import { VideosService } from '../videos/videos.service.js';
import { SCENE_DETECTOR, type SceneDetector } from './interface.js';
import type { SceneDetection } from './scene.model.js';

/** 404 for an unknown video, and 404 "scenes has not run" without a result. Times are seconds. */
@Controller(ROUTES.scenes.base)
export class SceneDetectionController {
  constructor(
    @Inject(SCENE_DETECTOR) private readonly scenes: SceneDetector,
    private readonly videos: VideosService,
  ) {}

  /** Scenes in order, each with a `keyframeUrl` for its JPEG. */
  @Get(ROUTES.scenes.results)
  async results(@Param('videoId') videoId: string): Promise<SceneDetection> {
    await requireVideo(this.videos, videoId);
    return found(this.scenes.scenes(videoId), 'scenes');
  }

  @Get(ROUTES.scenes.keyframe)
  keyframe(
    @Param('videoId') videoId: string,
    @Param('sceneId') sceneId: string,
    @Res() res: Response,
  ) {
    const path = this.scenes.keyframePath(videoId, sceneId);
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
}

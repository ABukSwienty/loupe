import { Module } from '@nestjs/common';
import { InfraModule } from '../../infra/infra.module.js';
import { VideosModule } from '../videos/videos.module.js';
import { SceneDetectionController } from './scene-detection.controller.js';
import { SCENE_DETECTOR } from './interface.js';
import { SceneDetectionService } from './scene-detection.service.js';

@Module({
  imports: [InfraModule, VideosModule],
  controllers: [SceneDetectionController],
  providers: [{ provide: SCENE_DETECTOR, useClass: SceneDetectionService }],
  exports: [SCENE_DETECTOR],
})
export class SceneDetectionModule {}

import { Module } from '@nestjs/common';
import { InfraModule } from '../../infra/infra.module.js';
import { VideosModule } from '../videos/videos.module.js';
import { SceneDetectionModule } from '../scene-detection/scene-detection.module.js';
import { OcrController } from './ocr.controller.js';
import { OCR_READER } from './interface.js';
import { OcrService } from './ocr.service.js';

@Module({
  imports: [InfraModule, VideosModule, SceneDetectionModule],
  controllers: [OcrController],
  providers: [{ provide: OCR_READER, useClass: OcrService }],
  exports: [OCR_READER],
})
export class OcrModule {}

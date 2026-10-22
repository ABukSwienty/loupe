import { Module } from '@nestjs/common';
import { InfraModule } from '../../infra/infra.module.js';
import { VideosModule } from '../videos/videos.module.js';
import { DiarizationController } from './diarization.controller.js';
import { DIARIZER } from './interface.js';
import { DiarizationService } from './diarization.service.js';

@Module({
  imports: [InfraModule, VideosModule],
  controllers: [DiarizationController],
  providers: [{ provide: DIARIZER, useClass: DiarizationService }],
  exports: [DIARIZER],
})
export class DiarizationModule {}

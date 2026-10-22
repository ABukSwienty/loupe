import { Module } from '@nestjs/common';
import { InfraModule } from '../../infra/infra.module.js';
import { VideosModule } from '../videos/videos.module.js';
import { TranscriptionController } from './transcription.controller.js';
import { TRANSCRIBER } from './interface.js';
import { TranscriptionService } from './transcription.service.js';

@Module({
  imports: [InfraModule, VideosModule],
  controllers: [TranscriptionController],
  providers: [{ provide: TRANSCRIBER, useClass: TranscriptionService }],
  exports: [TRANSCRIBER],
})
export class TranscriptionModule {}

import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { InfraModule } from '../../infra/infra.module.js';
import { QueueRunner } from '../../infra/queue/queue.runner.js';
import { VideosModule } from '../videos/videos.module.js';
import { AnalysisController } from './analysis.controller.js';
import { ANALYSIS_JOBS, type AnalysisJobInputs } from './analysis.jobs.js';
import { AnalysisService } from './analysis.service.js';
import { DiarizationModule } from '../diarization/diarization.module.js';
import { DIARIZER, type Diarizer } from '../diarization/interface.js';
import { EmbeddingModule } from '../embedding/embedding.module.js';
import { EMBEDDER, type Embedder } from '../embedding/interface.js';
import { OCR_READER, type OcrReader } from '../ocr/interface.js';
import { OcrModule } from '../ocr/ocr.module.js';
import {
  SCENE_DETECTOR,
  type SceneDetector,
} from '../scene-detection/interface.js';
import { SceneDetectionModule } from '../scene-detection/scene-detection.module.js';
import { TRANSCRIBER, type Transcriber } from '../transcription/interface.js';
import { TranscriptionModule } from '../transcription/transcription.module.js';

@Module({
  imports: [
    InfraModule,
    VideosModule,
    TranscriptionModule,
    DiarizationModule,
    SceneDetectionModule,
    OcrModule,
    EmbeddingModule,
  ],
  controllers: [AnalysisController],
  providers: [AnalysisService],
  exports: [AnalysisService],
})
export class AnalysisModule implements OnModuleInit {
  constructor(
    private readonly runner: QueueRunner,
    @Inject(TRANSCRIBER) private readonly transcription: Transcriber,
    @Inject(DIARIZER) private readonly diarization: Diarizer,
    @Inject(SCENE_DETECTOR) private readonly scenes: SceneDetector,
    @Inject(OCR_READER) private readonly ocr: OcrReader,
    @Inject(EMBEDDER) private readonly embedding: Embedder,
  ) {}

  onModuleInit() {
    this.runner.register<AnalysisJobInputs['transcribe'], unknown>(
      ANALYSIS_JOBS.transcribe,
      (input, { signal }) => this.transcription.transcribe(input, signal),
    );
    this.runner.register<AnalysisJobInputs['diarize'], unknown>(
      ANALYSIS_JOBS.diarize,
      (input, { signal }) => this.diarization.diarize(input, signal),
    );
    this.runner.register<AnalysisJobInputs['scenes'], unknown>(
      ANALYSIS_JOBS.scenes,
      (input, { signal }) => this.scenes.detect(input, signal),
    );
    this.runner.register<AnalysisJobInputs['ocr'], unknown>(
      ANALYSIS_JOBS.ocr,
      (input, { signal }) => this.ocr.ocr(input, signal),
    );
    this.runner.register<AnalysisJobInputs['embedTranscript'], unknown>(
      ANALYSIS_JOBS.embedTranscript,
      (input, { signal }) => this.embedding.embedTranscript(input, signal),
    );
    this.runner.register<AnalysisJobInputs['embedScenes'], unknown>(
      ANALYSIS_JOBS.embedScenes,
      (input, { signal }) => this.embedding.embedScenes(input, signal),
    );
  }
}

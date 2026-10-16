import { Module, type OnModuleInit } from '@nestjs/common';
import { InfraModule } from '../../infra/infra.module.js';
import { QueueRunner } from '../../infra/queue/queue.runner.js';
import { VideosModule } from '../videos/videos.module.js';
import { AnalysisResultsController } from './analysis-results.controller.js';
import { AnalysisResultsService } from './analysis-results.service.js';
import { AnalysisController } from './analysis.controller.js';
import { ANALYSIS_JOBS, type AnalysisJobInputs } from './analysis.jobs.js';
import { AnalysisService } from './analysis.service.js';
import { DiarizationService } from './diarization.service.js';
import { EmbeddingService } from './embedding.service.js';
import { OcrService } from './ocr.service.js';
import { SceneDetectionService } from './scene-detection.service.js';
import { TranscriptionService } from './transcription.service.js';

@Module({
  imports: [InfraModule, VideosModule],
  controllers: [AnalysisController, AnalysisResultsController],
  providers: [
    AnalysisService,
    AnalysisResultsService,
    TranscriptionService,
    DiarizationService,
    SceneDetectionService,
    OcrService,
    EmbeddingService,
  ],
  exports: [AnalysisService, AnalysisResultsService],
})
export class AnalysisModule implements OnModuleInit {
  constructor(
    private readonly runner: QueueRunner,
    private readonly transcription: TranscriptionService,
    private readonly diarization: DiarizationService,
    private readonly scenes: SceneDetectionService,
    private readonly ocr: OcrService,
    private readonly embedding: EmbeddingService,
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

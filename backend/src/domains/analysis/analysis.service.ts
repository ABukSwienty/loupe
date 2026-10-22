import { Inject, Injectable } from '@nestjs/common';
import { JOB_QUEUE, type JobQueue } from '../../infra/queue/interface.js';
import { JobState } from '../../infra/queue/job.model.js';
import { DOWNLOAD_JOB, VideosService } from '../videos/videos.service.js';
import { DIARIZER, type Diarizer } from '../diarization/interface.js';
import { EMBEDDER, type Embedder } from '../embedding/interface.js';
import { OCR_READER, type OcrReader } from '../ocr/interface.js';
import {
  ANALYSIS_JOBS,
  type AnalysisJobInputs,
  type AnalysisStep,
} from './analysis.jobs.js';
import type { AnalysisOverview } from './analysis.model.js';
import {
  SCENE_DETECTOR,
  type SceneDetector,
} from '../scene-detection/interface.js';
import { TRANSCRIBER, type Transcriber } from '../transcription/interface.js';

export class VideoNotFoundError extends Error {}

/** The step needs a result that doesn't exist and isn't queued either. */
export class MissingPrerequisiteError extends Error {}

@Injectable()
export class AnalysisService {
  constructor(
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    private readonly videos: VideosService,
    @Inject(TRANSCRIBER) private readonly transcription: Transcriber,
    @Inject(SCENE_DETECTOR) private readonly scenes: SceneDetector,
    @Inject(DIARIZER) private readonly diarization: Diarizer,
    @Inject(OCR_READER) private readonly ocr: OcrReader,
    @Inject(EMBEDDER) private readonly embedding: Embedder,
  ) {}

  /** What each step has stored for the video, from the steps' own summaries. */
  async overview(videoId: string): Promise<AnalysisOverview> {
    if (!(await this.videos.findOne(videoId))) {
      throw new VideoNotFoundError(`Video ${videoId} not found`);
    }
    return {
      transcription: this.transcription.summary(videoId),
      diarization: this.diarization.summary(videoId),
      scenes: this.scenes.summary(videoId),
      ocr: this.ocr.summary(videoId),
      embeddings: this.embedding.coverage(videoId),
    };
  }

  /**
   * Queues an analysis step for a video. If the same step is already queued
   * or running for it, returns that job instead (its params win).
   *
   * Prerequisites may still be queued: the runner takes jobs in order, so a
   * download, then scenes, then OCR can be requested back to back.
   */
  async enqueue<S extends AnalysisStep>(
    step: S,
    input: AnalysisJobInputs[S],
  ): Promise<{ jobId: string; queued: boolean }> {
    const { videoId } = input;
    const video = await this.videos.findOne(videoId);
    if (!video) throw new VideoNotFoundError(`Video ${videoId} not found`);

    const name = ANALYSIS_JOBS[step];
    const pending = await this.pendingJob(name, videoId);
    if (pending) return { jobId: pending, queued: false };

    await this.checkPrerequisite(
      step,
      videoId,
      video.lowResPath ?? video.filePath,
    );

    const job = await this.queue.create({ name, input });
    return { jobId: job.id, queued: true };
  }

  private async checkPrerequisite(
    step: AnalysisStep,
    videoId: string,
    file: string | null,
  ) {
    switch (step) {
      case 'transcribe':
      case 'diarize':
      case 'scenes':
        if (file || (await this.pendingJob(DOWNLOAD_JOB, videoId))) return;
        throw new MissingPrerequisiteError(
          `Video ${videoId} has not been downloaded`,
        );
      case 'ocr':
      case 'embedScenes':
        if (
          this.scenes.keyframeScenes(videoId).length > 0 ||
          (await this.pendingJob(ANALYSIS_JOBS.scenes, videoId))
        ) {
          return;
        }
        throw new MissingPrerequisiteError(
          `Video ${videoId} has no scenes; run scenes first`,
        );
      case 'embedTranscript':
        if (
          this.transcription.hasTranscription(videoId) ||
          (await this.pendingJob(ANALYSIS_JOBS.transcribe, videoId))
        ) {
          return;
        }
        throw new MissingPrerequisiteError(
          `Video ${videoId} has no transcription; run transcribe first`,
        );
    }
  }

  /** Id of a queued or running job with this name for the video. */
  private async pendingJob(
    name: string,
    videoId: string,
  ): Promise<string | null> {
    for (const state of [JobState.Queued, JobState.Processing]) {
      const jobs = await this.queue.findMany({ name, state });
      const job = jobs.find(
        (j) => (j.input as { videoId?: string }).videoId === videoId,
      );
      if (job) return job.id;
    }
    return null;
  }
}

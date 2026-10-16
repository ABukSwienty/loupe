import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Store } from '../../infra/store/client.js';
import {
  transcriptionChunks,
  transcriptions,
  transcriptionSegments,
} from '../../infra/store/schema/index.js';
import { STORE } from '../../infra/store/store.module.js';
import {
  WORKER_CLIENT,
  type WorkerClient,
} from '../../infra/worker-client/interface.js';
import { VideosService } from '../videos/videos.service.js';
import type { AnalysisJobInputs } from './analysis.jobs.js';
import { chunkSegments } from './chunking.js';
import { batches, INSERT_BATCH, videoUpload } from './media.js';

@Injectable()
export class TranscriptionService {
  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(WORKER_CLIENT) private readonly worker: WorkerClient,
    private readonly videos: VideosService,
  ) {}

  /**
   * Job handler: transcribes the video, replaces its previous transcription
   * and splits the segments into chunks for embedding. Replacing removes the
   * old chunks' embeddings too, so embed-transcript has to run again.
   */
  async transcribe(
    { videoId, language }: AnalysisJobInputs['transcribe'],
    signal?: AbortSignal,
  ) {
    const video = await this.videos.findOne(videoId);
    if (!video) return null; // deleted since the job was queued

    const res = await this.worker.transcribe(
      await videoUpload(video),
      { language },
      { signal },
    );

    const id = randomUUID();
    const segments = res.segments.map((s, index) => ({
      transcriptionId: id,
      index,
      start: s.start,
      end: s.end,
      text: s.text,
      avgLogprob: s.avg_logprob,
      noSpeechProb: s.no_speech_prob,
      words: s.words,
    }));
    const chunks = chunkSegments(segments).map((c) => ({
      ...c,
      transcriptionId: id,
    }));

    this.store.transaction((tx) => {
      tx.delete(transcriptions)
        .where(eq(transcriptions.videoId, videoId))
        .run();
      tx.insert(transcriptions)
        .values({
          id,
          videoId,
          language: res.language,
          languageProbability: res.language_probability,
          duration: res.duration,
          createdAt: Date.now(),
        })
        .run();
      for (const batch of batches(segments, INSERT_BATCH)) {
        tx.insert(transcriptionSegments).values(batch).run();
      }
      for (const batch of batches(chunks, INSERT_BATCH)) {
        tx.insert(transcriptionChunks).values(batch).run();
      }
    });

    return {
      transcriptionId: id,
      language: res.language,
      segments: segments.length,
      chunks: chunks.length,
    };
  }

  hasTranscription(videoId: string): boolean {
    return (
      this.store
        .select({ id: transcriptions.id })
        .from(transcriptions)
        .where(eq(transcriptions.videoId, videoId))
        .get() !== undefined
    );
  }
}

import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { asc, count, eq } from 'drizzle-orm';
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
import { batches, INSERT_BATCH, videoUpload } from '../../common/media.js';
import { chunkSegments } from './chunking.js';
import type { TranscribeInput, Transcriber } from './interface.js';
import type {
  Transcription,
  TranscriptionChunk,
  TranscriptionSummary,
} from './transcription.model.js';

@Injectable()
export class TranscriptionService implements Transcriber {
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
    { videoId, language }: TranscribeInput,
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

  transcription(
    videoId: string,
    options: { chunks: boolean },
  ): (Transcription & { chunks?: TranscriptionChunk[] }) | null {
    const row = this.current(videoId);
    if (!row) return null;

    const segments = this.store
      .select()
      .from(transcriptionSegments)
      .where(eq(transcriptionSegments.transcriptionId, row.id))
      .orderBy(asc(transcriptionSegments.index))
      .all()
      .map((row) => {
        const { id: _, transcriptionId: __, ...segment } = row;
        return segment;
      });

    if (!options.chunks) return { ...row, segments };
    const chunks = this.store
      .select()
      .from(transcriptionChunks)
      .where(eq(transcriptionChunks.transcriptionId, row.id))
      .orderBy(asc(transcriptionChunks.index))
      .all();
    return { ...row, segments, chunks };
  }

  summary(videoId: string): TranscriptionSummary | null {
    const row = this.current(videoId);
    if (!row) return null;
    const n = (
      table: typeof transcriptionSegments | typeof transcriptionChunks,
    ) =>
      this.store
        .select({ n: count() })
        .from(table)
        .where(eq(table.transcriptionId, row.id))
        .get()!.n;
    return {
      id: row.id,
      createdAt: row.createdAt,
      language: row.language,
      segments: n(transcriptionSegments),
      chunks: n(transcriptionChunks),
    };
  }

  private current(videoId: string) {
    return this.store
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.videoId, videoId))
      .get();
  }
}

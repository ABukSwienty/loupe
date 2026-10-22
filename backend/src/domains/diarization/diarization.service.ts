import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq } from 'drizzle-orm';
import type { Store } from '../../infra/store/client.js';
import {
  diarizations,
  diarizationSegments,
} from '../../infra/store/schema/index.js';
import { STORE } from '../../infra/store/store.module.js';
import {
  WORKER_CLIENT,
  type WorkerClient,
} from '../../infra/worker-client/interface.js';
import { VideosService } from '../videos/videos.service.js';
import { batches, INSERT_BATCH, videoUpload } from '../../common/media.js';
import {
  toDiarization,
  type Diarization,
  type DiarizationSummary,
} from './diarization.model.js';
import type { DiarizeInput, Diarizer } from './interface.js';

@Injectable()
export class DiarizationService implements Diarizer {
  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(WORKER_CLIENT) private readonly worker: WorkerClient,
    private readonly videos: VideosService,
  ) {}

  /** Job handler: finds who speaks when and replaces the previous diarization. */
  async diarize({ videoId, ...params }: DiarizeInput, signal?: AbortSignal) {
    const video = await this.videos.findOne(videoId);
    if (!video) return null; // deleted since the job was queued

    const res = await this.worker.diarize(await videoUpload(video), params, {
      signal,
    });

    const id = randomUUID();
    const segments = [
      ...res.segments.map((s) => ({ ...s, exclusive: false })),
      ...res.exclusive_segments.map((s) => ({ ...s, exclusive: true })),
    ].map((s) => ({
      diarizationId: id,
      start: s.start,
      end: s.end,
      speaker: s.speaker,
      exclusive: s.exclusive,
    }));

    this.store.transaction((tx) => {
      tx.delete(diarizations).where(eq(diarizations.videoId, videoId)).run();
      tx.insert(diarizations)
        .values({
          id,
          videoId,
          speakers: res.speakers,
          createdAt: Date.now(),
        })
        .run();
      for (const batch of batches(segments, INSERT_BATCH)) {
        tx.insert(diarizationSegments).values(batch).run();
      }
    });

    return {
      diarizationId: id,
      speakers: res.speakers.length,
      segments: res.segments.length,
    };
  }

  diarization(videoId: string): Diarization | null {
    const row = this.current(videoId);
    if (!row) return null;

    const segments = this.store
      .select()
      .from(diarizationSegments)
      .where(eq(diarizationSegments.diarizationId, row.id))
      .orderBy(asc(diarizationSegments.start), asc(diarizationSegments.id))
      .all();
    return toDiarization(row, segments);
  }

  summary(videoId: string): DiarizationSummary | null {
    const row = this.current(videoId);
    if (!row) return null;
    return {
      id: row.id,
      createdAt: row.createdAt,
      speakers: row.speakers.length,
      segments: this.store
        .select({ n: count() })
        .from(diarizationSegments)
        .where(
          and(
            eq(diarizationSegments.diarizationId, row.id),
            eq(diarizationSegments.exclusive, false),
          ),
        )
        .get()!.n,
    };
  }

  private current(videoId: string) {
    return this.store
      .select()
      .from(diarizations)
      .where(eq(diarizations.videoId, videoId))
      .get();
  }
}

import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
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
import type { AnalysisJobInputs } from './analysis.jobs.js';
import { batches, INSERT_BATCH, videoUpload } from './media.js';

@Injectable()
export class DiarizationService {
  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(WORKER_CLIENT) private readonly worker: WorkerClient,
    private readonly videos: VideosService,
  ) {}

  /** Job handler: finds who speaks when and replaces the previous diarization. */
  async diarize(
    { videoId, ...params }: AnalysisJobInputs['diarize'],
    signal?: AbortSignal,
  ) {
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
}

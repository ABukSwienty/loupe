import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Store } from '../../infra/store/client.js';
import { ocrLines, ocrResults } from '../../infra/store/schema/index.js';
import { STORE } from '../../infra/store/store.module.js';
import {
  WORKER_CLIENT,
  type WorkerClient,
} from '../../infra/worker-client/interface.js';
import type { AnalysisJobInputs } from './analysis.jobs.js';
import { batches, fileUpload, INSERT_BATCH } from './media.js';
import { SceneDetectionService } from './scene-detection.service.js';

/** Keyframes per worker request. */
const OCR_BATCH = 16;

@Injectable()
export class OcrService {
  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(WORKER_CLIENT) private readonly worker: WorkerClient,
    private readonly scenes: SceneDetectionService,
  ) {}

  /** Job handler: reads the text in every scene keyframe and replaces the video's previous OCR results. */
  async ocr({ videoId }: AnalysisJobInputs['ocr'], signal?: AbortSignal) {
    const keyframes = this.scenes.keyframeScenes(videoId);
    if (keyframes.length === 0) {
      throw new Error(
        `Video ${videoId} has no scene keyframes; run scenes first`,
      );
    }

    const results: (typeof ocrResults.$inferInsert)[] = [];
    const lines: (typeof ocrLines.$inferInsert)[] = [];
    for (const batch of batches(keyframes, OCR_BATCH)) {
      const res = await this.worker.ocr(
        await Promise.all(batch.map((k) => fileUpload(k.keyframePath))),
        { signal },
      );
      // Results come back in the order the files were sent.
      res.results.forEach((result, i) => {
        const scene = batch[i];
        const id = randomUUID();
        results.push({
          id,
          videoId,
          sceneId: scene.id,
          time: scene.keyframeTime,
          imagePath: scene.keyframePath,
          createdAt: Date.now(),
        });
        for (const line of result.lines) {
          lines.push({ ocrResultId: id, ...line });
        }
      });
    }

    this.store.transaction((tx) => {
      tx.delete(ocrResults).where(eq(ocrResults.videoId, videoId)).run();
      for (const batch of batches(results, INSERT_BATCH)) {
        tx.insert(ocrResults).values(batch).run();
      }
      for (const batch of batches(lines, INSERT_BATCH)) {
        tx.insert(ocrLines).values(batch).run();
      }
    });

    return { images: results.length, lines: lines.length };
  }
}

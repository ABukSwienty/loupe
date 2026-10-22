import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { asc, count, eq, max } from 'drizzle-orm';
import type { Store } from '../../infra/store/client.js';
import { ocrLines, ocrResults } from '../../infra/store/schema/index.js';
import { STORE } from '../../infra/store/store.module.js';
import {
  WORKER_CLIENT,
  type WorkerClient,
} from '../../infra/worker-client/interface.js';
import { batches, fileUpload, INSERT_BATCH } from '../../common/media.js';
import {
  SCENE_DETECTOR,
  type SceneDetector,
} from '../scene-detection/interface.js';
import type { OcrInput, OcrReader } from './interface.js';
import type { OcrResult, OcrSummary } from './ocr.model.js';

/** Keyframes per worker request. */
const OCR_BATCH = 16;

@Injectable()
export class OcrService implements OcrReader {
  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(WORKER_CLIENT) private readonly worker: WorkerClient,
    @Inject(SCENE_DETECTOR) private readonly scenes: SceneDetector,
  ) {}

  /** Job handler: reads the text in every scene keyframe and replaces the video's previous OCR results. */
  async ocr({ videoId }: OcrInput, signal?: AbortSignal) {
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

  results(videoId: string): OcrResult[] | null {
    const results = this.store
      .select()
      .from(ocrResults)
      .where(eq(ocrResults.videoId, videoId))
      .orderBy(asc(ocrResults.time), asc(ocrResults.id))
      .all();
    if (results.length === 0) return null;

    const lines = this.store
      .select()
      .from(ocrLines)
      .innerJoin(ocrResults, eq(ocrLines.ocrResultId, ocrResults.id))
      .where(eq(ocrResults.videoId, videoId))
      .orderBy(asc(ocrLines.id))
      .all();
    const byResult = new Map<string, OcrResult['lines']>();
    for (const { ocr_lines: line } of lines) {
      const { id: _, ocrResultId, ...rest } = line;
      const list = byResult.get(ocrResultId) ?? [];
      list.push(rest);
      byResult.set(ocrResultId, list);
    }

    return results.map((row) => {
      const { imagePath: _, ...result } = row;
      return { ...result, lines: byResult.get(result.id) ?? [] };
    });
  }

  summary(videoId: string): OcrSummary | null {
    const { images, createdAt } = this.store
      .select({ images: count(), createdAt: max(ocrResults.createdAt) })
      .from(ocrResults)
      .where(eq(ocrResults.videoId, videoId))
      .get()!;
    if (images === 0) return null;
    return {
      createdAt: createdAt!,
      images,
      lines: this.store
        .select({ n: count() })
        .from(ocrLines)
        .innerJoin(ocrResults, eq(ocrLines.ocrResultId, ocrResults.id))
        .where(eq(ocrResults.videoId, videoId))
        .get()!.n,
    };
  }
}

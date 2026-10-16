import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import type { Store } from '../../infra/store/client.js';
import { sceneDetections, scenes } from '../../infra/store/schema/index.js';
import { STORE } from '../../infra/store/store.module.js';
import {
  WORKER_CLIENT,
  type WorkerClient,
} from '../../infra/worker-client/interface.js';
import { VideosService } from '../videos/videos.service.js';
import type { AnalysisJobInputs } from './analysis.jobs.js';
import { batches, INSERT_BATCH, videoUpload } from './media.js';

export type KeyframeScene = {
  id: string;
  keyframePath: string;
  keyframeTime: number | null;
};

@Injectable()
export class SceneDetectionService {
  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(WORKER_CLIENT) private readonly worker: WorkerClient,
    private readonly videos: VideosService,
  ) {}

  /**
   * Job handler: detects scenes, writes one keyframe JPEG per scene to disk
   * and replaces the previous detection. Replacing removes the old scenes' OCR
   * results and embeddings too, so those steps have to run again.
   */
  async detect(
    { videoId, ...params }: AnalysisJobInputs['scenes'],
    signal?: AbortSignal,
  ) {
    const video = await this.videos.findOne(videoId);
    if (!video) return null; // deleted since the job was queued

    const res = await this.worker.scenes(
      await videoUpload(video),
      { ...params, keyframes: true },
      { signal },
    );

    const id = randomUUID();
    const videoDir = this.keyframesDir(videoId);
    const dir = join(videoDir, id);
    await mkdir(dir, { recursive: true });

    try {
      const rows = await Promise.all(
        res.scenes.map(async (s) => {
          let keyframePath: string | null = null;
          if (s.keyframe) {
            keyframePath = join(dir, `${String(s.index).padStart(4, '0')}.jpg`);
            await writeFile(
              keyframePath,
              Buffer.from(s.keyframe.jpeg_base64, 'base64'),
            );
          }
          return {
            id: randomUUID(),
            sceneDetectionId: id,
            index: s.index,
            start: s.start,
            end: s.end,
            startFrame: s.start_frame,
            endFrame: s.end_frame,
            keyframeTime: s.keyframe?.time ?? null,
            keyframePath,
          };
        }),
      );

      this.store.transaction((tx) => {
        tx.delete(sceneDetections)
          .where(eq(sceneDetections.videoId, videoId))
          .run();
        tx.insert(sceneDetections)
          .values({
            id,
            videoId,
            detector: res.detector,
            threshold: params.threshold,
            fps: res.fps,
            duration: res.duration,
            sceneCount: res.scene_count,
            createdAt: Date.now(),
          })
          .run();
        for (const batch of batches(rows, INSERT_BATCH)) {
          tx.insert(scenes).values(batch).run();
        }
      });
    } catch (err) {
      await rm(dir, { recursive: true, force: true });
      throw err;
    }

    // Keyframes of the replaced detection.
    const names = await readdir(videoDir).catch(() => []);
    await Promise.all(
      names
        .filter((n) => n !== id)
        .map((n) => rm(join(videoDir, n), { recursive: true, force: true })),
    );

    return { sceneDetectionId: id, scenes: res.scenes.length };
  }

  /** Scenes of the video's detection that have a keyframe on disk, in order. */
  keyframeScenes(videoId: string): KeyframeScene[] {
    return this.store
      .select({
        id: scenes.id,
        keyframePath: scenes.keyframePath,
        keyframeTime: scenes.keyframeTime,
      })
      .from(scenes)
      .innerJoin(
        sceneDetections,
        eq(scenes.sceneDetectionId, sceneDetections.id),
      )
      .where(
        and(
          eq(sceneDetections.videoId, videoId),
          isNotNull(scenes.keyframePath),
        ),
      )
      .orderBy(asc(scenes.index))
      .all() as KeyframeScene[];
  }

  private keyframesDir(videoId: string) {
    return resolve(this.videos.mediaDir, 'keyframes', videoId);
  }
}

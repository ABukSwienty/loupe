import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { Store } from '../../infra/store/client.js';
import {
  sceneDetections,
  transcriptionChunks,
  transcriptions,
} from '../../infra/store/schema/index.js';
import { STORE } from '../../infra/store/store.module.js';
import {
  chunkEmbeddingCoverage,
  saveChunkEmbeddings,
  saveSceneEmbeddings,
  sceneEmbeddingCoverage,
  type EmbeddingCoverage,
} from '../../infra/store/vectors.js';
import {
  WORKER_CLIENT,
  type WorkerClient,
} from '../../infra/worker-client/interface.js';
import { batches, fileUpload } from '../../common/media.js';
import {
  SCENE_DETECTOR,
  type SceneDetector,
} from '../scene-detection/interface.js';
import type {
  EmbedScenesInput,
  EmbedTranscriptInput,
  Embedder,
  EmbeddingCoverageByKind,
} from './interface.js';

/** Texts or images per worker request. */
const EMBED_BATCH = 16;

const NO_COVERAGE: EmbeddingCoverage = { embedded: 0, total: 0, models: [] };

@Injectable()
export class EmbeddingService implements Embedder {
  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(WORKER_CLIENT) private readonly worker: WorkerClient,
    @Inject(SCENE_DETECTOR) private readonly scenes: SceneDetector,
  ) {}

  /** Job handler: embeds every transcript chunk with bge-m3, replacing earlier vectors. */
  async embedTranscript(
    { videoId }: EmbedTranscriptInput,
    signal?: AbortSignal,
  ) {
    const chunks = this.store
      .select({ id: transcriptionChunks.id, text: transcriptionChunks.text })
      .from(transcriptionChunks)
      .innerJoin(
        transcriptions,
        eq(transcriptionChunks.transcriptionId, transcriptions.id),
      )
      .where(eq(transcriptions.videoId, videoId))
      .orderBy(asc(transcriptionChunks.index))
      .all();
    if (chunks.length === 0) {
      throw new Error(
        `Video ${videoId} has no transcript chunks; run transcribe first`,
      );
    }

    let model = '';
    for (const batch of batches(chunks, EMBED_BATCH)) {
      const res = await this.worker.embedDocuments(
        batch.map((c) => c.text),
        { signal },
      );
      model = res.model;
      saveChunkEmbeddings(
        this.store,
        res.model,
        batch.map((c, i) => ({ chunkId: c.id, vector: res.vectors[i] })),
      );
    }

    return { model, chunks: chunks.length };
  }

  /** Job handler: embeds every scene keyframe with SigLIP, replacing earlier vectors. */
  async embedScenes({ videoId }: EmbedScenesInput, signal?: AbortSignal) {
    const keyframes = this.scenes.keyframeScenes(videoId);
    if (keyframes.length === 0) {
      throw new Error(
        `Video ${videoId} has no scene keyframes; run scenes first`,
      );
    }

    let model = '';
    for (const batch of batches(keyframes, EMBED_BATCH)) {
      const res = await this.worker.embedImages(
        await Promise.all(batch.map((k) => fileUpload(k.keyframePath))),
        { signal },
      );
      model = res.model;
      // Results come back in the order the files were sent.
      saveSceneEmbeddings(
        this.store,
        res.model,
        batch.map((k, i) => ({ sceneId: k.id, vector: res.results[i].vector })),
      );
    }

    return { model, scenes: keyframes.length };
  }

  /** Vector coverage of the video's current transcription and scene detection. */
  coverage(videoId: string): EmbeddingCoverageByKind {
    const transcription = this.store
      .select({ id: transcriptions.id })
      .from(transcriptions)
      .where(eq(transcriptions.videoId, videoId))
      .get();
    const detection = this.store
      .select({ id: sceneDetections.id })
      .from(sceneDetections)
      .where(eq(sceneDetections.videoId, videoId))
      .get();
    return {
      transcript: transcription
        ? chunkEmbeddingCoverage(this.store, transcription.id)
        : NO_COVERAGE,
      scenes: detection
        ? sceneEmbeddingCoverage(this.store, detection.id)
        : NO_COVERAGE,
    };
  }
}

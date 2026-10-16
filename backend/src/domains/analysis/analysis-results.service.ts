import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, isNotNull, max, type SQL } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Store } from '../../infra/store/client.js';
import {
  diarizations,
  diarizationSegments,
  ocrLines,
  ocrResults,
  sceneDetections,
  scenes,
  transcriptionChunks,
  transcriptions,
  transcriptionSegments,
} from '../../infra/store/schema/index.js';
import { STORE } from '../../infra/store/store.module.js';
import {
  chunkEmbeddingCoverage,
  sceneEmbeddingCoverage,
  type EmbeddingCoverage,
} from '../../infra/store/vectors.js';
import {
  toDiarization,
  toScene,
  type AnalysisOverview,
  type Diarization,
  type OcrResult,
  type SceneDetection,
  type Transcription,
  type TranscriptionChunk,
} from './analysis.model.js';

const NO_COVERAGE: EmbeddingCoverage = { embedded: 0, total: 0, models: [] };

/**
 * Reads stored analysis results. Each video has at most one result per step,
 * because re-running a step replaces it. Methods return null when the step
 * hasn't run; they don't check that the video exists.
 */
@Injectable()
export class AnalysisResultsService {
  constructor(@Inject(STORE) private readonly store: Store) {}

  overview(videoId: string): AnalysisOverview {
    const transcription =
      this.store
        .select()
        .from(transcriptions)
        .where(eq(transcriptions.videoId, videoId))
        .get() ?? null;
    const diarization =
      this.store
        .select()
        .from(diarizations)
        .where(eq(diarizations.videoId, videoId))
        .get() ?? null;
    const detection =
      this.store
        .select()
        .from(sceneDetections)
        .where(eq(sceneDetections.videoId, videoId))
        .get() ?? null;
    const ocr = this.store
      .select({ images: count(), createdAt: max(ocrResults.createdAt) })
      .from(ocrResults)
      .where(eq(ocrResults.videoId, videoId))
      .get()!;

    return {
      transcription: transcription && {
        id: transcription.id,
        createdAt: transcription.createdAt,
        language: transcription.language,
        segments: this.count(
          transcriptionSegments,
          eq(transcriptionSegments.transcriptionId, transcription.id),
        ),
        chunks: this.count(
          transcriptionChunks,
          eq(transcriptionChunks.transcriptionId, transcription.id),
        ),
      },
      diarization: diarization && {
        id: diarization.id,
        createdAt: diarization.createdAt,
        speakers: diarization.speakers.length,
        segments: this.count(
          diarizationSegments,
          and(
            eq(diarizationSegments.diarizationId, diarization.id),
            eq(diarizationSegments.exclusive, false),
          ),
        ),
      },
      scenes: detection && {
        id: detection.id,
        createdAt: detection.createdAt,
        scenes: this.count(scenes, eq(scenes.sceneDetectionId, detection.id)),
        keyframes: this.count(
          scenes,
          and(
            eq(scenes.sceneDetectionId, detection.id),
            isNotNull(scenes.keyframePath),
          ),
        ),
      },
      ocr:
        ocr.images > 0
          ? {
              createdAt: ocr.createdAt!,
              images: ocr.images,
              lines: this.store
                .select({ n: count() })
                .from(ocrLines)
                .innerJoin(ocrResults, eq(ocrLines.ocrResultId, ocrResults.id))
                .where(eq(ocrResults.videoId, videoId))
                .get()!.n,
            }
          : null,
      embeddings: {
        transcript: transcription
          ? chunkEmbeddingCoverage(this.store, transcription.id)
          : NO_COVERAGE,
        scenes: detection
          ? sceneEmbeddingCoverage(this.store, detection.id)
          : NO_COVERAGE,
      },
    };
  }

  private count(table: SQLiteTable, filter: SQL | undefined): number {
    return this.store.select({ n: count() }).from(table).where(filter).get()!.n;
  }

  transcription(
    videoId: string,
    options: { chunks: boolean },
  ): (Transcription & { chunks?: TranscriptionChunk[] }) | null {
    const row = this.store
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.videoId, videoId))
      .get();
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

  diarization(videoId: string): Diarization | null {
    const row = this.store
      .select()
      .from(diarizations)
      .where(eq(diarizations.videoId, videoId))
      .get();
    if (!row) return null;

    const segments = this.store
      .select()
      .from(diarizationSegments)
      .where(eq(diarizationSegments.diarizationId, row.id))
      .orderBy(asc(diarizationSegments.start), asc(diarizationSegments.id))
      .all();
    return toDiarization(row, segments);
  }

  scenes(videoId: string): SceneDetection | null {
    const row = this.store
      .select()
      .from(sceneDetections)
      .where(eq(sceneDetections.videoId, videoId))
      .get();
    if (!row) return null;

    const rows = this.store
      .select()
      .from(scenes)
      .where(eq(scenes.sceneDetectionId, row.id))
      .orderBy(asc(scenes.index))
      .all();
    return { ...row, scenes: rows.map((s) => toScene(videoId, s)) };
  }

  /** The keyframe file of one of the video's scenes, or null. */
  keyframePath(videoId: string, sceneId: string): string | null {
    const row = this.store
      .select({ path: scenes.keyframePath })
      .from(scenes)
      .innerJoin(
        sceneDetections,
        eq(scenes.sceneDetectionId, sceneDetections.id),
      )
      .where(and(eq(scenes.id, sceneId), eq(sceneDetections.videoId, videoId)))
      .get();
    return row?.path ?? null;
  }

  /** OCR results in video order, or null if OCR hasn't run. */
  ocr(videoId: string): OcrResult[] | null {
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
}

import type { EmbeddingCoverage } from '../../infra/store/vectors.js';

export const EMBEDDER = Symbol('EMBEDDER');

export type EmbedTranscriptInput = { videoId: string };
export type EmbedScenesInput = { videoId: string };

export type EmbeddingCoverageByKind = {
  /** Chunks of the current transcription that have a vector, out of all its chunks. */
  transcript: EmbeddingCoverage;
  /** Keyframes of the current scene detection that have a vector. */
  scenes: EmbeddingCoverage;
};

export interface Embedder {
  /** Job handler: embeds every transcript chunk with bge-m3, replacing earlier vectors. */
  embedTranscript(
    input: EmbedTranscriptInput,
    signal?: AbortSignal,
  ): Promise<{ model: string; chunks: number }>;

  /** Job handler: embeds every scene keyframe with SigLIP, replacing earlier vectors. */
  embedScenes(
    input: EmbedScenesInput,
    signal?: AbortSignal,
  ): Promise<{ model: string; scenes: number }>;

  coverage(videoId: string): EmbeddingCoverageByKind;
}

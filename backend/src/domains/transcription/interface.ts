import type {
  Transcription,
  TranscriptionChunk,
  TranscriptionSummary,
} from './transcription.model.js';

export const TRANSCRIBER = Symbol('TRANSCRIBER');

export type TranscribeInput = { videoId: string; language: string | null };

export interface Transcriber {
  /**
   * Job handler: transcribes the video, replaces its previous transcription
   * and splits the segments into chunks for embedding. Replacing removes the
   * old chunks' embeddings too, so embed-transcript has to run again.
   */
  transcribe(
    input: TranscribeInput,
    signal?: AbortSignal,
  ): Promise<{
    transcriptionId: string;
    language: string;
    segments: number;
    chunks: number;
  } | null>;

  hasTranscription(videoId: string): boolean;

  /** The video's transcription with ordered segments, or null if it hasn't run. */
  transcription(
    videoId: string,
    options: { chunks: boolean },
  ): (Transcription & { chunks?: TranscriptionChunk[] }) | null;

  summary(videoId: string): TranscriptionSummary | null;
}

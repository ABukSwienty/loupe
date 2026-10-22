import type { Diarization, DiarizationSummary } from './diarization.model.js';

export const DIARIZER = Symbol('DIARIZER');

export type DiarizeInput = {
  videoId: string;
  numSpeakers: number | null;
  minSpeakers: number | null;
  maxSpeakers: number | null;
};

export interface Diarizer {
  /** Job handler: finds who speaks when and replaces the previous diarization. */
  diarize(
    input: DiarizeInput,
    signal?: AbortSignal,
  ): Promise<{
    diarizationId: string;
    speakers: number;
    segments: number;
  } | null>;

  /** The video's diarization, or null if it hasn't run. */
  diarization(videoId: string): Diarization | null;

  summary(videoId: string): DiarizationSummary | null;
}

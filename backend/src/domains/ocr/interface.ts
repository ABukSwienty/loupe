import type { OcrResult, OcrSummary } from './ocr.model.js';

export const OCR_READER = Symbol('OCR_READER');

export type OcrInput = { videoId: string };

export interface OcrReader {
  /** Job handler: reads the text in every scene keyframe and replaces the video's previous OCR results. */
  ocr(
    input: OcrInput,
    signal?: AbortSignal,
  ): Promise<{ images: number; lines: number }>;

  /** OCR results in video order, or null if OCR hasn't run. */
  results(videoId: string): OcrResult[] | null;

  summary(videoId: string): OcrSummary | null;
}

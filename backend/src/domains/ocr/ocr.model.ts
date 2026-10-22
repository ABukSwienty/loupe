import type { ocrLines, ocrResults } from '../../infra/store/schema/index.js';

export type OcrLine = Omit<typeof ocrLines.$inferSelect, 'id' | 'ocrResultId'>;

export type OcrResult = Omit<typeof ocrResults.$inferSelect, 'imagePath'> & {
  lines: OcrLine[];
};

export type OcrSummary = { createdAt: number; images: number; lines: number };

import type {
  transcriptionChunks,
  transcriptions,
  transcriptionSegments,
} from '../../infra/store/schema/index.js';

export type TranscriptionSegment = Omit<
  typeof transcriptionSegments.$inferSelect,
  'id' | 'transcriptionId'
>;

export type Transcription = typeof transcriptions.$inferSelect & {
  segments: TranscriptionSegment[];
};

export type TranscriptionChunk = typeof transcriptionChunks.$inferSelect;

export type TranscriptionSummary = {
  id: string;
  createdAt: number;
  language: string;
  segments: number;
  chunks: number;
};

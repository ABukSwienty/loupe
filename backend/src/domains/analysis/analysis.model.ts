import type {
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

// Each result is its parent row plus its child rows, in the same shape as the
// worker response where that makes sense.

export type TranscriptionSegment = Omit<
  typeof transcriptionSegments.$inferSelect,
  'id' | 'transcriptionId'
>;

export type Transcription = typeof transcriptions.$inferSelect & {
  segments: TranscriptionSegment[];
};

export type TranscriptionChunk = typeof transcriptionChunks.$inferSelect;

export type SpeakerTurn = Omit<
  typeof diarizationSegments.$inferSelect,
  'id' | 'diarizationId' | 'exclusive'
>;

export type Diarization = typeof diarizations.$inferSelect & {
  segments: SpeakerTurn[]; // may overlap
  exclusiveSegments: SpeakerTurn[]; // one speaker at a time
};

/** The keyframe is exposed as an API path, not the file path on the server. */
export type Scene = Omit<
  typeof scenes.$inferSelect,
  'sceneDetectionId' | 'keyframePath'
> & {
  /** GET this (relative to the API base) for the JPEG; null without a keyframe. */
  keyframeUrl: string | null;
};

export type SceneDetection = typeof sceneDetections.$inferSelect & {
  scenes: Scene[];
};

export type OcrLine = Omit<typeof ocrLines.$inferSelect, 'id' | 'ocrResultId'>;

export type OcrResult = Omit<typeof ocrResults.$inferSelect, 'imagePath'> & {
  lines: OcrLine[];
};

/** What has been computed for a video, without the results themselves. Null = the step hasn't run. */
export type AnalysisOverview = {
  transcription: {
    id: string;
    createdAt: number;
    language: string;
    segments: number;
    chunks: number;
  } | null;
  diarization: {
    id: string;
    createdAt: number;
    speakers: number;
    segments: number;
  } | null;
  scenes: {
    id: string;
    createdAt: number;
    scenes: number;
    keyframes: number;
  } | null;
  ocr: { createdAt: number; images: number; lines: number } | null;
  embeddings: {
    /** Chunks of the current transcription that have a vector, out of all its chunks. */
    transcript: { embedded: number; total: number; models: string[] };
    /** Keyframes of the current scene detection that have a vector. */
    scenes: { embedded: number; total: number; models: string[] };
  };
};

export function keyframeUrl(videoId: string, sceneId: string) {
  return `/videos/${videoId}/scenes/${sceneId}/keyframe`;
}

export function toScene(
  videoId: string,
  row: typeof scenes.$inferSelect,
): Scene {
  const { sceneDetectionId: _, keyframePath, ...rest } = row;
  return {
    ...rest,
    keyframeUrl: keyframePath ? keyframeUrl(videoId, row.id) : null,
  };
}

export function toDiarization(
  row: typeof diarizations.$inferSelect,
  segments: (typeof diarizationSegments.$inferSelect)[],
): Diarization {
  const turn = ({
    start,
    end,
    speaker,
  }: typeof diarizationSegments.$inferSelect): SpeakerTurn => ({
    start,
    end,
    speaker,
  });
  return {
    ...row,
    segments: segments.filter((s) => !s.exclusive).map(turn),
    exclusiveSegments: segments.filter((s) => s.exclusive).map(turn),
  };
}

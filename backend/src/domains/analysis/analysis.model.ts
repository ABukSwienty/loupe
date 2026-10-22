import type { DiarizationSummary } from '../diarization/diarization.model.js';
import type { EmbeddingCoverageByKind } from '../embedding/interface.js';
import type { OcrSummary } from '../ocr/ocr.model.js';
import type { SceneDetectionSummary } from '../scene-detection/scene.model.js';
import type { TranscriptionSummary } from '../transcription/transcription.model.js';

/** What has been computed for a video, without the results themselves. Null = the step hasn't run. */
export type AnalysisOverview = {
  transcription: TranscriptionSummary | null;
  diarization: DiarizationSummary | null;
  scenes: SceneDetectionSummary | null;
  ocr: OcrSummary | null;
  embeddings: EmbeddingCoverageByKind;
};

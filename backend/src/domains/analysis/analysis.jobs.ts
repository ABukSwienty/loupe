// Job names and inputs for the analysis steps. Each step is its own domain
// (transcription/, diarization/, ...) that owns its input type; AnalysisModule
// registers the handlers.

import type { DiarizeInput } from '../diarization/interface.js';
import type {
  EmbedScenesInput,
  EmbedTranscriptInput,
} from '../embedding/interface.js';
import type { OcrInput } from '../ocr/interface.js';
import type { SceneDetectionInput } from '../scene-detection/interface.js';
import type { TranscribeInput } from '../transcription/interface.js';

export const ANALYSIS_JOBS = {
  transcribe: 'analysis.transcribe',
  diarize: 'analysis.diarize',
  scenes: 'analysis.scenes',
  ocr: 'analysis.ocr',
  embedTranscript: 'analysis.embed-transcript',
  embedScenes: 'analysis.embed-scenes',
} as const;

export type AnalysisStep = keyof typeof ANALYSIS_JOBS;

export type AnalysisJobInputs = {
  transcribe: TranscribeInput;
  diarize: DiarizeInput;
  scenes: SceneDetectionInput;
  ocr: OcrInput;
  embedTranscript: EmbedTranscriptInput;
  embedScenes: EmbedScenesInput;
};

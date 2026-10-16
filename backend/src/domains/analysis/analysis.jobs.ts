// Job names and inputs for the analysis steps. Each step's handler lives in
// its own service and is registered in AnalysisModule.

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
  transcribe: { videoId: string; language: string | null };
  diarize: {
    videoId: string;
    numSpeakers: number | null;
    minSpeakers: number | null;
    maxSpeakers: number | null;
  };
  scenes: {
    videoId: string;
    detector: 'adaptive' | 'content';
    threshold: number | null;
    keyframeWidth: number;
  };
  ocr: { videoId: string };
  embedTranscript: { videoId: string };
  embedScenes: { videoId: string };
};

// Controller bases and paths, for the controllers and for building URLs the
// API returns (e.g. a scene's keyframeUrl).

export const ROUTES = {
  analysis: {
    base: 'videos/:videoId',
    overview: 'analysis',
    transcribe: 'transcribe',
    diarize: 'diarize',
    scenes: 'scenes',
    ocr: 'ocr',
    embedTranscript: 'embeddings/transcript',
    embedScenes: 'embeddings/scenes',
  },
  transcription: {
    base: 'transcription',
    results: ':videoId',
  },
  diarization: {
    base: 'diarization',
    results: ':videoId',
  },
  scenes: {
    base: 'scenes',
    results: ':videoId',
    keyframe: ':videoId/:sceneId/keyframe',
  },
  ocr: {
    base: 'ocr',
    results: ':videoId',
  },
} as const;

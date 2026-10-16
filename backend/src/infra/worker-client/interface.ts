// ---------- inputs ----------

/** A file to upload. In Node 20+: `await fs.openAsBlob(path)` or `new Blob([buffer])`. */
export interface UploadInput {
  data: Blob;
  filename: string; // extension is kept by the worker (e.g. "talk.mp4")
}

// ---------- responses (mirror the Python JSON exactly) ----------

export interface HealthResponse {
  status: 'ok';
  device: 'cuda' | 'mps' | 'cpu';
  models: {
    diarization: string;
    whisper: string;
    embed: string; // SigLIP 2: images and image-search queries
    text_embed: string; // bge-m3: documents (transcripts, OCR)
    ocr: string;
  };
  loaded: string[];
}

export interface SpeakerTurn {
  start: number; // seconds
  end: number;
  speaker: string; // "SPEAKER_00", file-local
}

export interface DiarizeResponse {
  speakers: string[];
  segments: SpeakerTurn[]; // may overlap
  exclusive_segments: SpeakerTurn[]; // one speaker at a time
}

export interface TranscriptWord {
  start: number;
  end: number;
  word: string;
  probability: number; // 0–1
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  avg_logprob: number;
  no_speech_prob: number; // 0–1, high = likely not speech
  words: TranscriptWord[];
}

export interface TranscribeResponse {
  language: string; // ISO code, e.g. "de"
  language_probability: number;
  duration: number; // seconds
  segments: TranscriptSegment[];
}

export interface Keyframe {
  time: number; // seconds
  jpeg_base64: string;
}

export interface Scene {
  index: number;
  start: number; // seconds
  end: number;
  start_frame: number;
  end_frame: number;
  keyframe?: Keyframe; // only when keyframes = true
}

export interface ScenesResponse {
  fps: number;
  duration: number;
  detector: 'adaptive' | 'content';
  scene_count: number;
  scenes: Scene[];
}

/** Vectors from one model are only comparable with vectors from the same model. */
export interface TextEmbedResponse {
  model: string;
  dim: number;
  vectors: number[][]; // unit length, same order as input texts
}

export interface ImageEmbedResponse {
  model: string;
  dim: number;
  results: { filename: string | null; vector: number[] }[];
}

export interface OcrLine {
  text: string;
  score: number; // 0–1
  box: [number, number][]; // corner points [x, y] in pixels, usually 4
}

export interface OcrResponse {
  results: { filename: string | null; lines: OcrLine[] }[];
}

// ---------- client ----------

export const WORKER_CLIENT = Symbol('WORKER_CLIENT');

/** Per-request options. Aborting the signal cancels the HTTP request. */
export interface RequestOptions {
  signal?: AbortSignal;
}

export interface WorkerClient {
  health(options?: RequestOptions): Promise<HealthResponse>;

  diarize(
    file: UploadInput,
    params: {
      numSpeakers: number | null;
      minSpeakers: number | null;
      maxSpeakers: number | null;
    },
    options?: RequestOptions,
  ): Promise<DiarizeResponse>;

  transcribe(
    file: UploadInput,
    params: {
      language: string | null; // null = auto-detect
    },
    options?: RequestOptions,
  ): Promise<TranscribeResponse>;

  scenes(
    file: UploadInput,
    params: {
      detector: 'adaptive' | 'content';
      threshold: number | null; // null = detector default (adaptive 3.0, content 27.0)
      keyframes: boolean;
      keyframeWidth: number; // 64–1920, default 512
    },
    options?: RequestOptions,
  ): Promise<ScenesResponse>;

  /** Text -> SigLIP vectors, for searching images and keyframes. */
  embedImageQueries(
    texts: string[],
    options?: RequestOptions,
  ): Promise<TextEmbedResponse>;

  /** Text -> bge-m3 vectors, for text-to-text retrieval (transcripts, OCR). */
  embedDocuments(
    texts: string[],
    options?: RequestOptions,
  ): Promise<TextEmbedResponse>;

  embedImages(
    files: UploadInput[],
    options?: RequestOptions,
  ): Promise<ImageEmbedResponse>;

  ocr(files: UploadInput[], options?: RequestOptions): Promise<OcrResponse>;
}

// Shared setup for the analysis step specs: an in-memory store, a temporary
// media dir with a downloaded video `v1`, and a fake worker with canned
// responses. Not part of the build.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QueueService } from '../infra/queue/queue.service.js';
import { openStore, type Store } from '../infra/store/client.js';
import { videos } from '../infra/store/schema/index.js';
import {
  CHUNK_EMBEDDING_DIM,
  SCENE_EMBEDDING_DIM,
} from '../infra/store/vectors.js';
import type { WorkerClient } from '../infra/worker-client/interface.js';
import type { YtDlp } from '../infra/yt-dlp/interface.js';
import { VideosService } from '../domains/videos/videos.service.js';
import type { SceneDetectionInput } from '../domains/scene-detection/interface.js';

/** A unit vector along axis i. */
export const unit = (dim: number, i = 0) =>
  Array.from({ length: dim }, (_, j) => (j === i ? 1 : 0));

const JPEG = Buffer.from('fake jpeg').toString('base64');

export const SCENES_INPUT: SceneDetectionInput = {
  videoId: 'v1',
  detector: 'adaptive',
  threshold: null,
  keyframeWidth: 512,
};

export function fakeWorker() {
  return {
    health: vi.fn(),
    transcribe: vi.fn(async () => ({
      language: 'de',
      language_probability: 0.98,
      duration: 50,
      segments: [
        {
          start: 0,
          end: 10,
          text: ' Hallo',
          avg_logprob: -0.1,
          no_speech_prob: 0.01,
          words: [],
        },
        {
          start: 10,
          end: 25,
          text: ' und',
          avg_logprob: -0.2,
          no_speech_prob: 0.02,
          words: [],
        },
        {
          start: 25,
          end: 40,
          text: ' tschüss',
          avg_logprob: -0.3,
          no_speech_prob: 0.03,
          words: [],
        },
      ],
    })),
    diarize: vi.fn(async () => ({
      speakers: ['SPEAKER_00', 'SPEAKER_01'],
      segments: [
        { start: 0, end: 12, speaker: 'SPEAKER_00' },
        { start: 10, end: 40, speaker: 'SPEAKER_01' },
      ],
      exclusive_segments: [
        { start: 0, end: 10, speaker: 'SPEAKER_00' },
        { start: 10, end: 40, speaker: 'SPEAKER_01' },
      ],
    })),
    scenes: vi.fn(async () => ({
      fps: 25,
      duration: 50,
      detector: 'adaptive' as const,
      scene_count: 2,
      scenes: [
        {
          index: 0,
          start: 0,
          end: 20,
          start_frame: 0,
          end_frame: 500,
          keyframe: { time: 10, jpeg_base64: JPEG },
        },
        {
          index: 1,
          start: 20,
          end: 50,
          start_frame: 500,
          end_frame: 1250,
          keyframe: { time: 35, jpeg_base64: JPEG },
        },
      ],
    })),
    ocr: vi.fn(async (files: unknown[]) => ({
      results: files.map((_, i) => ({
        filename: null,
        lines: [
          {
            text: `line ${i}`,
            score: 0.9,
            box: [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
            ] as [number, number][],
          },
        ],
      })),
    })),
    embedDocuments: vi.fn(async (texts: string[]) => ({
      model: 'bge-m3',
      dim: CHUNK_EMBEDDING_DIM,
      vectors: texts.map((_, i) => unit(CHUNK_EMBEDDING_DIM, i)),
    })),
    embedImageQueries: vi.fn(),
    embedImages: vi.fn(async (files: unknown[]) => ({
      model: 'siglip2',
      dim: SCENE_EMBEDDING_DIM,
      results: files.map((_, i) => ({
        filename: null,
        vector: unit(SCENE_EMBEDDING_DIM, i),
      })),
    })),
  } satisfies Record<keyof WorkerClient, unknown>;
}

export type AnalysisFixture = {
  store: Store;
  queue: QueueService;
  worker: ReturnType<typeof fakeWorker>;
  /** The fake worker, typed for service constructors. */
  workerClient: WorkerClient;
  videos: VideosService;
  mediaDir: string;
  addVideo: (id: string, lowResPath: string | null) => void;
  close: () => void;
};

/** Opens the fixture with video `v1` downloaded to `<mediaDir>/v1.low.mp4`. Call `close()` in afterEach. */
export function openAnalysisFixture(): AnalysisFixture {
  const store = openStore(':memory:');
  const queue = new QueueService(store);
  const worker = fakeWorker();
  const mediaDir = mkdtempSync(join(tmpdir(), 'loupe-analysis-'));
  const videosService = new VideosService(store, queue, {} as YtDlp);
  videosService.mediaDir = mediaDir;

  const addVideo = (id: string, lowResPath: string | null) => {
    store
      .insert(videos)
      .values({ id, title: id, lowResPath, createdAt: Date.now() })
      .run();
  };

  const file = join(mediaDir, 'v1.low.mp4');
  writeFileSync(file, 'video');
  addVideo('v1', file);

  return {
    store,
    queue,
    worker,
    workerClient: worker as unknown as WorkerClient,
    videos: videosService,
    mediaDir,
    addVideo,
    close: () => {
      store.$client.close();
      rmSync(mediaDir, { recursive: true, force: true });
    },
  };
}

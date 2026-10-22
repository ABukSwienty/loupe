import {
  openAnalysisFixture,
  SCENES_INPUT,
  type AnalysisFixture,
} from '../../testing/analysis-fixture.js';
import type {
  KeyframeScene,
  SceneDetector,
} from '../scene-detection/interface.js';
import type { Transcriber } from '../transcription/interface.js';
import type { Diarizer } from '../diarization/interface.js';
import type { Embedder } from '../embedding/interface.js';
import type { OcrReader } from '../ocr/interface.js';
import { DOWNLOAD_JOB } from '../videos/videos.service.js';
import { ANALYSIS_JOBS } from './analysis.jobs.js';
import {
  AnalysisService,
  MissingPrerequisiteError,
  VideoNotFoundError,
} from './analysis.service.js';

describe('AnalysisService', () => {
  let f: AnalysisFixture;
  let analysis: AnalysisService;
  // What the steps report having stored; the steps themselves are tested in their domains.
  let hasTranscription: boolean;
  let keyframes: KeyframeScene[];

  beforeEach(() => {
    f = openAnalysisFixture();
    hasTranscription = false;
    keyframes = [];
    const transcriber: Transcriber = {
      transcribe: vi.fn(),
      hasTranscription: () => hasTranscription,
      transcription: vi.fn(),
      summary: () =>
        hasTranscription
          ? { id: 't1', createdAt: 1, language: 'de', segments: 3, chunks: 2 }
          : null,
    };
    const sceneDetector: SceneDetector = {
      detect: vi.fn(),
      keyframeScenes: () => keyframes,
      scenes: vi.fn(),
      keyframePath: vi.fn(),
      summary: () => null,
    };
    const diarizer: Diarizer = {
      diarize: vi.fn(),
      diarization: vi.fn(),
      summary: () => null,
    };
    const ocr: OcrReader = {
      ocr: vi.fn(),
      results: vi.fn(),
      summary: () => null,
    };
    const embedder: Embedder = {
      embedTranscript: vi.fn(),
      embedScenes: vi.fn(),
      coverage: () => ({
        transcript: { embedded: 2, total: 2, models: ['bge-m3'] },
        scenes: { embedded: 0, total: 0, models: [] },
      }),
    };
    analysis = new AnalysisService(
      f.queue,
      f.videos,
      transcriber,
      sceneDetector,
      diarizer,
      ocr,
      embedder,
    );
  });

  afterEach(() => f.close());

  it('queues a job with its input', async () => {
    const { jobId, queued } = await analysis.enqueue('transcribe', {
      videoId: 'v1',
      language: 'de',
    });

    expect(queued).toBe(true);
    const job = await f.queue.findOne(jobId);
    expect(job?.name).toBe(ANALYSIS_JOBS.transcribe);
    expect(job?.input).toEqual({ videoId: 'v1', language: 'de' });
  });

  it('returns the pending job for the same step and video', async () => {
    const a = await analysis.enqueue('diarize', {
      videoId: 'v1',
      numSpeakers: null,
      minSpeakers: null,
      maxSpeakers: null,
    });
    const b = await analysis.enqueue('diarize', {
      videoId: 'v1',
      numSpeakers: 2,
      minSpeakers: null,
      maxSpeakers: null,
    });

    expect(b).toEqual({ jobId: a.jobId, queued: false });
  });

  it('rejects an unknown video', async () => {
    await expect(
      analysis.enqueue('transcribe', { videoId: 'gone', language: null }),
    ).rejects.toBeInstanceOf(VideoNotFoundError);
  });

  it('needs a downloaded file, or a download queued', async () => {
    f.addVideo('v2', null);
    const input = { ...SCENES_INPUT, videoId: 'v2' };
    await expect(analysis.enqueue('scenes', input)).rejects.toBeInstanceOf(
      MissingPrerequisiteError,
    );

    await f.queue.create({ name: DOWNLOAD_JOB, input: { videoId: 'v2' } });

    expect((await analysis.enqueue('scenes', input)).queued).toBe(true);
  });

  it('accepts a step whose prerequisite is queued', async () => {
    await expect(
      analysis.enqueue('embedTranscript', { videoId: 'v1' }),
    ).rejects.toBeInstanceOf(MissingPrerequisiteError);

    await analysis.enqueue('transcribe', { videoId: 'v1', language: null });

    expect(
      (await analysis.enqueue('embedTranscript', { videoId: 'v1' })).queued,
    ).toBe(true);
  });

  it('accepts a step whose prerequisite has run', async () => {
    await expect(
      analysis.enqueue('ocr', { videoId: 'v1' }),
    ).rejects.toBeInstanceOf(MissingPrerequisiteError);

    hasTranscription = true;
    keyframes = [{ id: 's1', keyframePath: '/k/0000.jpg', keyframeTime: 1 }];

    expect((await analysis.enqueue('ocr', { videoId: 'v1' })).queued).toBe(
      true,
    );
    expect(
      (await analysis.enqueue('embedScenes', { videoId: 'v1' })).queued,
    ).toBe(true);
    expect(
      (await analysis.enqueue('embedTranscript', { videoId: 'v1' })).queued,
    ).toBe(true);
  });

  it("builds the overview from the steps' summaries", async () => {
    hasTranscription = true;

    expect(await analysis.overview('v1')).toEqual({
      transcription: {
        id: 't1',
        createdAt: 1,
        language: 'de',
        segments: 3,
        chunks: 2,
      },
      diarization: null,
      scenes: null,
      ocr: null,
      embeddings: {
        transcript: { embedded: 2, total: 2, models: ['bge-m3'] },
        scenes: { embedded: 0, total: 0, models: [] },
      },
    });
  });

  it('rejects an overview for an unknown video', async () => {
    await expect(analysis.overview('gone')).rejects.toBeInstanceOf(
      VideoNotFoundError,
    );
  });
});

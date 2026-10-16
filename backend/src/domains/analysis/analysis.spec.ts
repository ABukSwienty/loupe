import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { QueueService } from '../../infra/queue/queue.service.js';
import { openStore, type Store } from '../../infra/store/client.js';
import {
  diarizationSegments,
  ocrLines,
  ocrResults,
  scenes,
  transcriptionChunks,
  transcriptions,
  transcriptionSegments,
  videos,
} from '../../infra/store/schema/index.js';
import {
  CHUNK_EMBEDDING_DIM,
  SCENE_EMBEDDING_DIM,
  searchChunkEmbeddings,
  searchSceneEmbeddings,
} from '../../infra/store/vectors.js';
import type { WorkerClient } from '../../infra/worker-client/interface.js';
import type { YtDlp } from '../../infra/yt-dlp/interface.js';
import { DOWNLOAD_JOB, VideosService } from '../videos/videos.service.js';
import { ANALYSIS_JOBS } from './analysis.jobs.js';
import { AnalysisResultsService } from './analysis-results.service.js';
import {
  AnalysisService,
  MissingPrerequisiteError,
  VideoNotFoundError,
} from './analysis.service.js';
import { DiarizationService } from './diarization.service.js';
import { EmbeddingService } from './embedding.service.js';
import { OcrService } from './ocr.service.js';
import { SceneDetectionService } from './scene-detection.service.js';
import { TranscriptionService } from './transcription.service.js';

const unit = (dim: number, i = 0) =>
  Array.from({ length: dim }, (_, j) => (j === i ? 1 : 0));

const JPEG = Buffer.from('fake jpeg').toString('base64');

function fakeWorker() {
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

describe('analysis', () => {
  let store: Store;
  let queue: QueueService;
  let worker: ReturnType<typeof fakeWorker>;
  let mediaDir: string;
  let videosService: VideosService;
  let transcription: TranscriptionService;
  let diarization: DiarizationService;
  let sceneDetection: SceneDetectionService;
  let ocr: OcrService;
  let embedding: EmbeddingService;
  let analysis: AnalysisService;

  const addVideo = (id: string, lowResPath: string | null) =>
    store
      .insert(videos)
      .values({ id, title: id, lowResPath, createdAt: Date.now() })
      .run();

  beforeEach(() => {
    store = openStore(':memory:');
    queue = new QueueService(store);
    worker = fakeWorker();
    mediaDir = mkdtempSync(join(tmpdir(), 'loupe-analysis-'));
    videosService = new VideosService(store, queue, {} as YtDlp);
    videosService.mediaDir = mediaDir;
    const w = worker as unknown as WorkerClient;
    transcription = new TranscriptionService(store, w, videosService);
    diarization = new DiarizationService(store, w, videosService);
    sceneDetection = new SceneDetectionService(store, w, videosService);
    ocr = new OcrService(store, w, sceneDetection);
    embedding = new EmbeddingService(store, w, sceneDetection);
    analysis = new AnalysisService(
      queue,
      videosService,
      transcription,
      sceneDetection,
    );

    const file = join(mediaDir, 'v1.low.mp4');
    writeFileSync(file, 'video');
    addVideo('v1', file);
  });

  afterEach(() => {
    store.$client.close();
    rmSync(mediaDir, { recursive: true, force: true });
  });

  const runScenes = () =>
    sceneDetection.detect({
      videoId: 'v1',
      detector: 'adaptive',
      threshold: null,
      keyframeWidth: 512,
    });

  describe('transcribe', () => {
    it('uploads the low-res file and stores segments and chunks', async () => {
      const out = await transcription.transcribe({
        videoId: 'v1',
        language: null,
      });

      const [file, params] = worker.transcribe.mock.calls[0] as unknown as [
        { filename: string },
        unknown,
      ];
      expect(file.filename).toBe('v1.low.mp4');
      expect(params).toEqual({ language: null });
      expect(out).toMatchObject({ language: 'de', segments: 3, chunks: 2 });

      const segments = store.select().from(transcriptionSegments).all();
      expect(segments.map((s) => s.index)).toEqual([0, 1, 2]);
      const chunks = store.select().from(transcriptionChunks).all();
      expect(chunks.map((c) => [c.startSegment, c.endSegment, c.text])).toEqual(
        [
          [0, 1, 'Hallo und'],
          [2, 2, 'tschüss'],
        ],
      );
    });

    it('replaces the previous transcription', async () => {
      await transcription.transcribe({ videoId: 'v1', language: null });
      const second = await transcription.transcribe({
        videoId: 'v1',
        language: 'de',
      });

      const rows = store.select().from(transcriptions).all();
      expect(rows.map((r) => r.id)).toEqual([second!.transcriptionId]);
      expect(store.select().from(transcriptionSegments).all()).toHaveLength(3);
    });

    it('does nothing for a deleted video', async () => {
      expect(
        await transcription.transcribe({ videoId: 'gone', language: null }),
      ).toBeNull();
      expect(worker.transcribe).not.toHaveBeenCalled();
    });

    it('fails for a video that was never downloaded', async () => {
      addVideo('v2', null);
      await expect(
        transcription.transcribe({ videoId: 'v2', language: null }),
      ).rejects.toThrow(/not been downloaded/);
    });
  });

  describe('diarize', () => {
    it('stores overlapping and exclusive segments', async () => {
      const out = await diarization.diarize({
        videoId: 'v1',
        numSpeakers: null,
        minSpeakers: 1,
        maxSpeakers: 3,
      });

      expect((worker.diarize.mock.calls[0] as unknown[])[1]).toEqual({
        numSpeakers: null,
        minSpeakers: 1,
        maxSpeakers: 3,
      });
      expect(out).toMatchObject({ speakers: 2, segments: 2 });
      const rows = store.select().from(diarizationSegments).all();
      expect(rows.filter((r) => r.exclusive)).toHaveLength(2);
      expect(rows.filter((r) => !r.exclusive)).toHaveLength(2);
    });
  });

  describe('scenes', () => {
    it('asks for keyframes and writes them to disk', async () => {
      const out = await runScenes();

      expect((worker.scenes.mock.calls[0] as unknown[])[1]).toMatchObject({
        keyframes: true,
      });
      expect(out?.scenes).toBe(2);
      const rows = store.select().from(scenes).all();
      for (const row of rows) expect(existsSync(row.keyframePath!)).toBe(true);
      expect(rows.map((r) => r.keyframeTime)).toEqual([10, 35]);
    });

    it('replaces the previous detection and its keyframes', async () => {
      await runScenes();
      const second = await runScenes();

      const dir = join(mediaDir, 'keyframes', 'v1');
      expect(readdirSync(dir)).toEqual([second!.sceneDetectionId]);
      expect(store.select().from(scenes).all()).toHaveLength(2);
    });
  });

  describe('ocr', () => {
    it('reads every keyframe and links lines to their scene', async () => {
      await runScenes();

      const out = await ocr.ocr({ videoId: 'v1' });

      expect(out).toEqual({ images: 2, lines: 2 });
      const results = store.select().from(ocrResults).all();
      const sceneIds = store
        .select({ id: scenes.id })
        .from(scenes)
        .all()
        .map((s) => s.id);
      expect(results.map((r) => r.sceneId).sort()).toEqual(sceneIds.sort());
      expect(results.map((r) => r.time).sort()).toEqual([10, 35]);
      expect(store.select().from(ocrLines).all()).toHaveLength(2);
    });

    it('replaces earlier results', async () => {
      await runScenes();
      await ocr.ocr({ videoId: 'v1' });
      await ocr.ocr({ videoId: 'v1' });

      expect(store.select().from(ocrResults).all()).toHaveLength(2);
    });

    it('fails without scenes', async () => {
      await expect(ocr.ocr({ videoId: 'v1' })).rejects.toThrow(
        /run scenes first/,
      );
    });
  });

  describe('embeddings', () => {
    it('embeds transcript chunks with their model', async () => {
      await transcription.transcribe({ videoId: 'v1', language: null });

      const out = await embedding.embedTranscript({ videoId: 'v1' });

      expect(out).toEqual({ model: 'bge-m3', chunks: 2 });
      expect(worker.embedDocuments).toHaveBeenCalledWith(
        ['Hallo und', 'tschüss'],
        expect.anything(),
      );
      const [hit] = searchChunkEmbeddings(store, unit(CHUNK_EMBEDDING_DIM, 1), {
        k: 1,
        model: 'bge-m3',
      });
      const chunk = store
        .select()
        .from(transcriptionChunks)
        .where(eq(transcriptionChunks.id, hit.id))
        .get();
      expect(chunk?.text).toBe('tschüss');
    });

    it('embeds scene keyframes', async () => {
      await runScenes();

      const out = await embedding.embedScenes({ videoId: 'v1' });

      expect(out).toEqual({ model: 'siglip2', scenes: 2 });
      expect(
        searchSceneEmbeddings(store, unit(SCENE_EMBEDDING_DIM, 0)),
      ).toHaveLength(2);
    });

    it('fails without a transcription or scenes', async () => {
      await expect(
        embedding.embedTranscript({ videoId: 'v1' }),
      ).rejects.toThrow(/run transcribe first/);
      await expect(embedding.embedScenes({ videoId: 'v1' })).rejects.toThrow(
        /run scenes first/,
      );
    });
  });

  describe('enqueue', () => {
    it('queues a job with its input', async () => {
      const { jobId, queued } = await analysis.enqueue('transcribe', {
        videoId: 'v1',
        language: 'de',
      });

      expect(queued).toBe(true);
      const job = await queue.findOne(jobId);
      expect(job?.name).toBe(ANALYSIS_JOBS.transcribe);
      expect(job?.input).toEqual({ videoId: 'v1', language: 'de' });
    });

    it('returns the pending job for the same step and video', async () => {
      const first = await analysis
        .enqueue('ocr', { videoId: 'v1' })
        .catch(() => null);
      expect(first).toBeNull(); // no scenes yet

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
      addVideo('v2', null);
      await expect(
        analysis.enqueue('scenes', {
          videoId: 'v2',
          detector: 'adaptive',
          threshold: null,
          keyframeWidth: 512,
        }),
      ).rejects.toBeInstanceOf(MissingPrerequisiteError);

      await queue.create({ name: DOWNLOAD_JOB, input: { videoId: 'v2' } });

      const { queued } = await analysis.enqueue('scenes', {
        videoId: 'v2',
        detector: 'adaptive',
        threshold: null,
        keyframeWidth: 512,
      });
      expect(queued).toBe(true);
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
      await runScenes();

      expect((await analysis.enqueue('ocr', { videoId: 'v1' })).queued).toBe(
        true,
      );
      expect(
        (await analysis.enqueue('embedScenes', { videoId: 'v1' })).queued,
      ).toBe(true);
    });
  });

  describe('results', () => {
    let results: AnalysisResultsService;

    beforeEach(() => {
      results = new AnalysisResultsService(store);
    });

    const runAll = async () => {
      await transcription.transcribe({ videoId: 'v1', language: null });
      await diarization.diarize({
        videoId: 'v1',
        numSpeakers: null,
        minSpeakers: null,
        maxSpeakers: null,
      });
      await runScenes();
      await ocr.ocr({ videoId: 'v1' });
      await embedding.embedTranscript({ videoId: 'v1' });
    };

    it('reports nothing before any step has run', () => {
      expect(results.overview('v1')).toEqual({
        transcription: null,
        diarization: null,
        scenes: null,
        ocr: null,
        embeddings: {
          transcript: { embedded: 0, total: 0, models: [] },
          scenes: { embedded: 0, total: 0, models: [] },
        },
      });
      expect(results.transcription('v1', { chunks: false })).toBeNull();
      expect(results.diarization('v1')).toBeNull();
      expect(results.scenes('v1')).toBeNull();
      expect(results.ocr('v1')).toBeNull();
    });

    it('summarises every step, including partial embedding coverage', async () => {
      await runAll();

      expect(results.overview('v1')).toMatchObject({
        transcription: { language: 'de', segments: 3, chunks: 2 },
        diarization: { speakers: 2, segments: 2 },
        scenes: { scenes: 2, keyframes: 2 },
        ocr: { images: 2, lines: 2 },
        embeddings: {
          transcript: { embedded: 2, total: 2, models: ['bge-m3'] },
          scenes: { embedded: 0, total: 2, models: [] },
        },
      });
    });

    it('returns the transcription in order, with chunks on request', async () => {
      await runAll();

      const plain = results.transcription('v1', { chunks: false })!;
      expect(plain.segments.map((s) => s.text)).toEqual([
        ' Hallo',
        ' und',
        ' tschüss',
      ]);
      expect(plain.segments[0]).not.toHaveProperty('transcriptionId');
      expect(plain).not.toHaveProperty('chunks');

      const withChunks = results.transcription('v1', { chunks: true })!;
      expect(withChunks.chunks?.map((c) => c.text)).toEqual([
        'Hallo und',
        'tschüss',
      ]);
    });

    it('splits diarization back into the two segment lists', async () => {
      await runAll();

      const d = results.diarization('v1')!;
      expect(d.speakers).toEqual(['SPEAKER_00', 'SPEAKER_01']);
      expect(d.segments).toEqual([
        { start: 0, end: 12, speaker: 'SPEAKER_00' },
        { start: 10, end: 40, speaker: 'SPEAKER_01' },
      ]);
      expect(d.exclusiveSegments).toHaveLength(2);
    });

    it('exposes keyframes as URLs and resolves them to files for the right video only', async () => {
      await runAll();

      const detection = results.scenes('v1')!;
      const [first] = detection.scenes;
      expect(first).not.toHaveProperty('keyframePath');
      expect(first.keyframeUrl).toBe(`/videos/v1/scenes/${first.id}/keyframe`);

      const path = results.keyframePath('v1', first.id);
      expect(path && existsSync(path)).toBe(true);
      expect(results.keyframePath('other-video', first.id)).toBeNull();
      expect(results.keyframePath('v1', 'missing')).toBeNull();
    });

    it('returns OCR results in video order with their lines', async () => {
      await runAll();

      const ocrResults = results.ocr('v1')!;
      expect(ocrResults.map((r) => r.time)).toEqual([10, 35]);
      expect(ocrResults[0]).not.toHaveProperty('imagePath');
      expect(ocrResults.map((r) => r.lines.map((l) => l.text))).toEqual([
        ['line 0'],
        ['line 1'],
      ]);
    });
  });
});

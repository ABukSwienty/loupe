import {
  transcriptionChunks,
  transcriptions,
  transcriptionSegments,
} from '../../infra/store/schema/index.js';
import {
  openAnalysisFixture,
  type AnalysisFixture,
} from '../../testing/analysis-fixture.js';
import { TranscriptionService } from './transcription.service.js';

describe('TranscriptionService', () => {
  let f: AnalysisFixture;
  let transcription: TranscriptionService;

  beforeEach(() => {
    f = openAnalysisFixture();
    transcription = new TranscriptionService(f.store, f.workerClient, f.videos);
  });

  afterEach(() => f.close());

  it('uploads the low-res file and stores segments and chunks', async () => {
    const out = await transcription.transcribe({
      videoId: 'v1',
      language: null,
    });

    const [file, params] = f.worker.transcribe.mock.calls[0] as unknown as [
      { filename: string },
      unknown,
    ];
    expect(file.filename).toBe('v1.low.mp4');
    expect(params).toEqual({ language: null });
    expect(out).toMatchObject({ language: 'de', segments: 3, chunks: 2 });

    const segments = f.store.select().from(transcriptionSegments).all();
    expect(segments.map((s) => s.index)).toEqual([0, 1, 2]);
    const chunks = f.store.select().from(transcriptionChunks).all();
    expect(chunks.map((c) => [c.startSegment, c.endSegment, c.text])).toEqual([
      [0, 1, 'Hallo und'],
      [2, 2, 'tschüss'],
    ]);
  });

  it('replaces the previous transcription', async () => {
    await transcription.transcribe({ videoId: 'v1', language: null });
    const second = await transcription.transcribe({
      videoId: 'v1',
      language: 'de',
    });

    const rows = f.store.select().from(transcriptions).all();
    expect(rows.map((r) => r.id)).toEqual([second!.transcriptionId]);
    expect(f.store.select().from(transcriptionSegments).all()).toHaveLength(3);
  });

  it('does nothing for a deleted video', async () => {
    expect(
      await transcription.transcribe({ videoId: 'gone', language: null }),
    ).toBeNull();
    expect(f.worker.transcribe).not.toHaveBeenCalled();
  });

  it('fails for a video that was never downloaded', async () => {
    f.addVideo('v2', null);
    await expect(
      transcription.transcribe({ videoId: 'v2', language: null }),
    ).rejects.toThrow(/not been downloaded/);
  });

  it('reports whether a video has a transcription', async () => {
    expect(transcription.hasTranscription('v1')).toBe(false);
    await transcription.transcribe({ videoId: 'v1', language: null });
    expect(transcription.hasTranscription('v1')).toBe(true);
  });

  it('returns nothing before transcribing', () => {
    expect(transcription.transcription('v1', { chunks: false })).toBeNull();
    expect(transcription.summary('v1')).toBeNull();
  });

  it('returns the transcription in order, with chunks on request', async () => {
    await transcription.transcribe({ videoId: 'v1', language: null });

    const plain = transcription.transcription('v1', { chunks: false })!;
    expect(plain.segments.map((s) => s.text)).toEqual([
      ' Hallo',
      ' und',
      ' tschüss',
    ]);
    expect(plain.segments[0]).not.toHaveProperty('transcriptionId');
    expect(plain).not.toHaveProperty('chunks');

    const withChunks = transcription.transcription('v1', { chunks: true })!;
    expect(withChunks.chunks?.map((c) => c.text)).toEqual([
      'Hallo und',
      'tschüss',
    ]);
  });

  it('summarises the transcription', async () => {
    await transcription.transcribe({ videoId: 'v1', language: null });

    expect(transcription.summary('v1')).toMatchObject({
      language: 'de',
      segments: 3,
      chunks: 2,
    });
  });
});

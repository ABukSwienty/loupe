import { diarizationSegments } from '../../infra/store/schema/index.js';
import {
  openAnalysisFixture,
  type AnalysisFixture,
} from '../../testing/analysis-fixture.js';
import { DiarizationService } from './diarization.service.js';

describe('DiarizationService', () => {
  let f: AnalysisFixture;
  let diarization: DiarizationService;

  beforeEach(() => {
    f = openAnalysisFixture();
    diarization = new DiarizationService(f.store, f.workerClient, f.videos);
  });

  afterEach(() => f.close());

  it('stores overlapping and exclusive segments', async () => {
    const out = await diarization.diarize({
      videoId: 'v1',
      numSpeakers: null,
      minSpeakers: 1,
      maxSpeakers: 3,
    });

    expect((f.worker.diarize.mock.calls[0] as unknown[])[1]).toEqual({
      numSpeakers: null,
      minSpeakers: 1,
      maxSpeakers: 3,
    });
    expect(out).toMatchObject({ speakers: 2, segments: 2 });
    const rows = f.store.select().from(diarizationSegments).all();
    expect(rows.filter((r) => r.exclusive)).toHaveLength(2);
    expect(rows.filter((r) => !r.exclusive)).toHaveLength(2);
  });

  it('does nothing for a deleted video', async () => {
    expect(
      await diarization.diarize({
        videoId: 'gone',
        numSpeakers: null,
        minSpeakers: null,
        maxSpeakers: null,
      }),
    ).toBeNull();
    expect(f.worker.diarize).not.toHaveBeenCalled();
  });

  it('splits the stored segments back into the two lists', async () => {
    expect(diarization.diarization('v1')).toBeNull();
    await diarization.diarize({
      videoId: 'v1',
      numSpeakers: null,
      minSpeakers: null,
      maxSpeakers: null,
    });

    const d = diarization.diarization('v1')!;
    expect(d.speakers).toEqual(['SPEAKER_00', 'SPEAKER_01']);
    expect(d.segments).toEqual([
      { start: 0, end: 12, speaker: 'SPEAKER_00' },
      { start: 10, end: 40, speaker: 'SPEAKER_01' },
    ]);
    expect(d.exclusiveSegments).toHaveLength(2);
    expect(diarization.summary('v1')).toMatchObject({
      speakers: 2,
      segments: 2,
    });
  });
});

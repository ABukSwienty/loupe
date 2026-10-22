import {
  ocrLines,
  ocrResults,
  scenes,
} from '../../infra/store/schema/index.js';
import {
  openAnalysisFixture,
  SCENES_INPUT,
  type AnalysisFixture,
} from '../../testing/analysis-fixture.js';
import { SceneDetectionService } from '../scene-detection/scene-detection.service.js';
import { OcrService } from './ocr.service.js';

describe('OcrService', () => {
  let f: AnalysisFixture;
  let sceneDetection: SceneDetectionService;
  let ocr: OcrService;

  beforeEach(() => {
    f = openAnalysisFixture();
    sceneDetection = new SceneDetectionService(
      f.store,
      f.workerClient,
      f.videos,
    );
    ocr = new OcrService(f.store, f.workerClient, sceneDetection);
  });

  afterEach(() => f.close());

  it('reads every keyframe and links lines to their scene', async () => {
    await sceneDetection.detect(SCENES_INPUT);

    const out = await ocr.ocr({ videoId: 'v1' });

    expect(out).toEqual({ images: 2, lines: 2 });
    const results = f.store.select().from(ocrResults).all();
    const sceneIds = f.store
      .select({ id: scenes.id })
      .from(scenes)
      .all()
      .map((s) => s.id);
    expect(results.map((r) => r.sceneId).sort()).toEqual(sceneIds.sort());
    expect(results.map((r) => r.time).sort()).toEqual([10, 35]);
    expect(f.store.select().from(ocrLines).all()).toHaveLength(2);
  });

  it('replaces earlier results', async () => {
    await sceneDetection.detect(SCENES_INPUT);
    await ocr.ocr({ videoId: 'v1' });
    await ocr.ocr({ videoId: 'v1' });

    expect(f.store.select().from(ocrResults).all()).toHaveLength(2);
  });

  it('fails without scenes', async () => {
    await expect(ocr.ocr({ videoId: 'v1' })).rejects.toThrow(
      /run scenes first/,
    );
  });

  it('returns results in video order with their lines', async () => {
    expect(ocr.results('v1')).toBeNull();
    expect(ocr.summary('v1')).toBeNull();
    await sceneDetection.detect(SCENES_INPUT);
    await ocr.ocr({ videoId: 'v1' });

    const results = ocr.results('v1')!;
    expect(results.map((r) => r.time)).toEqual([10, 35]);
    expect(results[0]).not.toHaveProperty('imagePath');
    expect(results.map((r) => r.lines.map((l) => l.text))).toEqual([
      ['line 0'],
      ['line 1'],
    ]);
    expect(ocr.summary('v1')).toMatchObject({ images: 2, lines: 2 });
  });
});

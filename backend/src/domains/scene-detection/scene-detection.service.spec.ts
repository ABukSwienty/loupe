import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { scenes } from '../../infra/store/schema/index.js';
import {
  openAnalysisFixture,
  SCENES_INPUT,
  type AnalysisFixture,
} from '../../testing/analysis-fixture.js';
import { SceneDetectionService } from './scene-detection.service.js';

describe('SceneDetectionService', () => {
  let f: AnalysisFixture;
  let sceneDetection: SceneDetectionService;

  beforeEach(() => {
    f = openAnalysisFixture();
    sceneDetection = new SceneDetectionService(
      f.store,
      f.workerClient,
      f.videos,
    );
  });

  afterEach(() => f.close());

  it('asks for keyframes and writes them to disk', async () => {
    const out = await sceneDetection.detect(SCENES_INPUT);

    expect((f.worker.scenes.mock.calls[0] as unknown[])[1]).toMatchObject({
      keyframes: true,
    });
    expect(out?.scenes).toBe(2);
    const rows = f.store.select().from(scenes).all();
    for (const row of rows) expect(existsSync(row.keyframePath!)).toBe(true);
    expect(rows.map((r) => r.keyframeTime)).toEqual([10, 35]);
  });

  it('replaces the previous detection and its keyframes', async () => {
    await sceneDetection.detect(SCENES_INPUT);
    const second = await sceneDetection.detect(SCENES_INPUT);

    const dir = join(f.mediaDir, 'keyframes', 'v1');
    expect(readdirSync(dir)).toEqual([second!.sceneDetectionId]);
    expect(f.store.select().from(scenes).all()).toHaveLength(2);
  });

  it('lists the scenes with keyframes in order', async () => {
    expect(sceneDetection.keyframeScenes('v1')).toEqual([]);

    await sceneDetection.detect(SCENES_INPUT);

    const keyframes = sceneDetection.keyframeScenes('v1');
    expect(keyframes.map((k) => k.keyframeTime)).toEqual([10, 35]);
    for (const k of keyframes) expect(existsSync(k.keyframePath)).toBe(true);
  });

  it('exposes keyframes as URLs and resolves them to files for the right video only', async () => {
    expect(sceneDetection.scenes('v1')).toBeNull();
    await sceneDetection.detect(SCENES_INPUT);

    const [first] = sceneDetection.scenes('v1')!.scenes;
    expect(first).not.toHaveProperty('keyframePath');
    expect(first.keyframeUrl).toBe(`/scenes/v1/${first.id}/keyframe`);

    const path = sceneDetection.keyframePath('v1', first.id);
    expect(path && existsSync(path)).toBe(true);
    expect(sceneDetection.keyframePath('other-video', first.id)).toBeNull();
    expect(sceneDetection.keyframePath('v1', 'missing')).toBeNull();
  });

  it('summarises the detection', async () => {
    expect(sceneDetection.summary('v1')).toBeNull();
    await sceneDetection.detect(SCENES_INPUT);

    expect(sceneDetection.summary('v1')).toMatchObject({
      scenes: 2,
      keyframes: 2,
    });
  });
});

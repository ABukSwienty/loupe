import { eq } from 'drizzle-orm';
import { openStore, type Store } from '../client.js';
import {
  groups,
  groupVideos,
  ocrLines,
  ocrResults,
  sceneDetections,
  scenes,
  transcriptions,
  transcriptionSegments,
  videos,
} from './index.js';

describe('schema', () => {
  let store: Store;
  const now = Date.now();

  beforeEach(() => {
    store = openStore(':memory:');
    store
      .insert(videos)
      .values({ id: 'v1', title: 'Talk', createdAt: now })
      .run();
  });

  afterEach(() => {
    store.$client.close();
  });

  const seed = () => {
    store
      .insert(groups)
      .values({ id: 'g1', name: 'Set', createdAt: now })
      .run();
    store
      .insert(groupVideos)
      .values({ groupId: 'g1', videoId: 'v1', addedAt: now })
      .run();
    store
      .insert(transcriptions)
      .values({
        id: 't1',
        videoId: 'v1',
        language: 'de',
        languageProbability: 0.9,
        duration: 12.5,
        createdAt: now,
      })
      .run();
    store
      .insert(transcriptionSegments)
      .values({
        transcriptionId: 't1',
        index: 0,
        start: 0,
        end: 2.5,
        text: 'Hallo',
        avgLogprob: -0.2,
        noSpeechProb: 0.01,
        words: [{ start: 0, end: 0.5, word: 'Hallo', probability: 0.99 }],
      })
      .run();
    store
      .insert(sceneDetections)
      .values({
        id: 'sd1',
        videoId: 'v1',
        detector: 'adaptive',
        fps: 25,
        duration: 12.5,
        sceneCount: 1,
        createdAt: now,
      })
      .run();
    store
      .insert(scenes)
      .values({
        id: 's1',
        sceneDetectionId: 'sd1',
        index: 0,
        start: 0,
        end: 12.5,
        startFrame: 0,
        endFrame: 312,
      })
      .run();
    store
      .insert(ocrResults)
      .values({ id: 'o1', videoId: 'v1', sceneId: 's1', createdAt: now })
      .run();
    store
      .insert(ocrLines)
      .values({
        ocrResultId: 'o1',
        text: 'SANCTIONS',
        score: 0.95,
        box: [
          [0, 0],
          [10, 0],
          [10, 5],
          [0, 5],
        ],
      })
      .run();
  };

  it('round-trips json columns', () => {
    seed();

    const segment = store.select().from(transcriptionSegments).get();
    expect(segment?.words).toEqual([
      { start: 0, end: 0.5, word: 'Hallo', probability: 0.99 },
    ]);
    expect(store.select().from(ocrLines).get()?.box).toHaveLength(4);
  });

  it('rejects results for a video that does not exist', () => {
    expect(() =>
      store
        .insert(transcriptions)
        .values({
          id: 't2',
          videoId: 'missing',
          language: 'de',
          languageProbability: 1,
          duration: 1,
          createdAt: now,
        })
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it('removes results and group memberships when a video is deleted', () => {
    seed();

    store.delete(videos).where(eq(videos.id, 'v1')).run();

    for (const table of [
      groupVideos,
      transcriptions,
      transcriptionSegments,
      sceneDetections,
      scenes,
      ocrResults,
      ocrLines,
    ]) {
      expect(store.select().from(table).all()).toEqual([]);
    }
    expect(store.select().from(groups).all()).toHaveLength(1);
  });
});

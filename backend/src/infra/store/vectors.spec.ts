import { eq } from 'drizzle-orm';
import { openStore, type Store } from './client.js';
import {
  sceneDetections,
  scenes,
  transcriptionChunks,
  transcriptions,
  videos,
} from './schema/index.js';
import {
  CHUNK_EMBEDDING_DIM,
  saveChunkEmbeddings,
  saveSceneEmbeddings,
  SCENE_EMBEDDING_DIM,
  searchChunkEmbeddings,
  searchSceneEmbeddings,
} from './vectors.js';

/** A unit vector pointing mostly along one axis. */
const axis = (dim: number, i: number, tilt = 0) => {
  const v = Array.from({ length: dim }, () => 0);
  v[i] = 1;
  v[(i + 1) % dim] = tilt;
  return v;
};

describe('vectors', () => {
  let store: Store;
  const now = Date.now();

  beforeEach(() => {
    store = openStore(':memory:');
    store
      .insert(videos)
      .values({ id: 'v1', title: 'Talk', createdAt: now })
      .run();
    store
      .insert(transcriptions)
      .values({
        id: 't1',
        videoId: 'v1',
        language: 'de',
        languageProbability: 1,
        duration: 60,
        createdAt: now,
      })
      .run();
    store
      .insert(transcriptionChunks)
      .values(
        [0, 1, 2].map((i) => ({
          id: i + 1,
          transcriptionId: 't1',
          index: i,
          startSegment: i,
          endSegment: i,
          start: i * 30,
          end: i * 30 + 30,
          text: `chunk ${i}`,
        })),
      )
      .run();
    store
      .insert(sceneDetections)
      .values({
        id: 'sd1',
        videoId: 'v1',
        detector: 'adaptive',
        fps: 25,
        duration: 60,
        sceneCount: 2,
        createdAt: now,
      })
      .run();
    store
      .insert(scenes)
      .values(
        ['s1', 's2'].map((id, i) => ({
          id,
          sceneDetectionId: 'sd1',
          index: i,
          start: i * 30,
          end: i * 30 + 30,
          startFrame: i * 750,
          endFrame: i * 750 + 750,
        })),
      )
      .run();
  });

  afterEach(() => {
    store.$client.close();
  });

  const count = (table: string) =>
    (
      store.$client.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {
        n: number;
      }
    ).n;

  it('finds the nearest chunks, closest first', () => {
    saveChunkEmbeddings(store, 'bge-m3', [
      { chunkId: 1, vector: axis(CHUNK_EMBEDDING_DIM, 0) },
      { chunkId: 2, vector: axis(CHUNK_EMBEDDING_DIM, 1) },
      { chunkId: 3, vector: axis(CHUNK_EMBEDDING_DIM, 2) },
    ]);

    const hits = searchChunkEmbeddings(
      store,
      axis(CHUNK_EMBEDDING_DIM, 1, 0.1),
      { k: 2 },
    );

    expect(hits.map((h) => h.id)).toEqual([2, 3]);
    expect(hits[0].distance).toBeLessThan(hits[1].distance);
  });

  it('replaces a vector saved twice', () => {
    saveChunkEmbeddings(store, 'bge-m3', [
      { chunkId: 1, vector: axis(CHUNK_EMBEDDING_DIM, 0) },
    ]);
    saveChunkEmbeddings(store, 'bge-m3', [
      { chunkId: 1, vector: axis(CHUNK_EMBEDDING_DIM, 5) },
    ]);

    expect(count('chunk_embeddings')).toBe(1);
    const [hit] = searchChunkEmbeddings(store, axis(CHUNK_EMBEDDING_DIM, 5), {
      k: 1,
    });
    expect(hit.distance).toBeCloseTo(0);
  });

  it('filters by model', () => {
    saveSceneEmbeddings(store, 'siglip-a', [
      { sceneId: 's1', vector: axis(SCENE_EMBEDDING_DIM, 0) },
    ]);
    saveSceneEmbeddings(store, 'siglip-b', [
      { sceneId: 's2', vector: axis(SCENE_EMBEDDING_DIM, 0) },
    ]);

    const hits = searchSceneEmbeddings(store, axis(SCENE_EMBEDDING_DIM, 0), {
      model: 'siglip-b',
    });

    expect(hits.map((h) => h.id)).toEqual(['s2']);
  });

  it('rejects vectors of the wrong size', () => {
    expect(() =>
      saveSceneEmbeddings(store, 'siglip', [{ sceneId: 's1', vector: [1, 0] }]),
    ).toThrow(/768-dimension/);
  });

  it('removes vectors when their video is deleted', () => {
    saveChunkEmbeddings(store, 'bge-m3', [
      { chunkId: 1, vector: axis(CHUNK_EMBEDDING_DIM, 0) },
    ]);
    saveSceneEmbeddings(store, 'siglip', [
      { sceneId: 's1', vector: axis(SCENE_EMBEDDING_DIM, 0) },
    ]);

    store.delete(videos).where(eq(videos.id, 'v1')).run();

    expect(count('chunk_embeddings')).toBe(0);
    expect(count('scene_embeddings')).toBe(0);
  });
});

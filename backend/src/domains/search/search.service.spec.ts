import { openStore, type Store } from '../../infra/store/client.js';
import {
  sceneDetections,
  scenes,
  transcriptionChunks,
  transcriptions,
  transcriptionSegments,
  videos,
} from '../../infra/store/schema/index.js';
import {
  CHUNK_EMBEDDING_DIM,
  saveChunkEmbeddings,
  saveSceneEmbeddings,
  SCENE_EMBEDDING_DIM,
} from '../../infra/store/vectors.js';
import type { WorkerClient } from '../../infra/worker-client/interface.js';
import { QueueService } from '../../infra/queue/queue.service.js';
import type { YtDlp } from '../../infra/yt-dlp/interface.js';
import { GroupsService } from '../groups/groups.service.js';
import { VideosService } from '../videos/videos.service.js';
import { SearchScopeNotFoundError, SearchService } from './search.service.js';

/** A unit vector along one axis, slightly tilted towards the next. */
const axis = (dim: number, i: number, tilt = 0) =>
  Array.from({ length: dim }, (_, j) =>
    j === i ? 1 : j === (i + 1) % dim ? tilt : 0,
  );

describe('SearchService', () => {
  let store: Store;
  let worker: {
    embedDocuments: ReturnType<typeof vi.fn>;
    embedImageQueries: ReturnType<typeof vi.fn>;
  };
  let search: SearchService;
  let groups: GroupsService;
  const now = Date.now();

  beforeEach(() => {
    store = openStore(':memory:');
    worker = { embedDocuments: vi.fn(), embedImageQueries: vi.fn() };
    groups = new GroupsService(store);
    search = new SearchService(
      store,
      worker as unknown as WorkerClient,
      groups,
      new VideosService(store, new QueueService(store), {} as YtDlp),
    );

    store
      .insert(videos)
      .values({ id: 'v1', title: 'Talk', channel: 'Chan', createdAt: now })
      .run();
    store
      .insert(transcriptions)
      .values({
        id: 't1',
        videoId: 'v1',
        language: 'en',
        languageProbability: 1,
        duration: 60,
        createdAt: now,
      })
      .run();
    store
      .insert(transcriptionSegments)
      .values(
        [0, 1, 2, 3].map((index) => ({
          transcriptionId: 't1',
          index,
          start: index * 15,
          end: index * 15 + 15,
          text: `segment ${index}`,
          avgLogprob: -0.1,
          noSpeechProb: 0,
          words: [{ start: 0, end: 1, word: 'x', probability: 1 }],
        })),
      )
      .run();
    store
      .insert(transcriptionChunks)
      .values([
        {
          id: 1,
          transcriptionId: 't1',
          index: 0,
          startSegment: 0,
          endSegment: 1,
          start: 0,
          end: 30,
          text: 'about sanctions',
        },
        {
          id: 2,
          transcriptionId: 't1',
          index: 1,
          startSegment: 2,
          endSegment: 3,
          start: 30,
          end: 60,
          text: 'about weather',
        },
      ])
      .run();
    saveChunkEmbeddings(store, 'bge-m3', [
      { chunkId: 1, vector: axis(CHUNK_EMBEDDING_DIM, 0) },
      { chunkId: 2, vector: axis(CHUNK_EMBEDDING_DIM, 1) },
    ]);

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
      .values([
        {
          id: 's1',
          sceneDetectionId: 'sd1',
          index: 0,
          start: 0,
          end: 20,
          startFrame: 0,
          endFrame: 500,
          keyframeTime: 10,
          keyframePath: '/tmp/s1.jpg',
        },
        {
          id: 's2',
          sceneDetectionId: 'sd1',
          index: 1,
          start: 20,
          end: 60,
          startFrame: 500,
          endFrame: 1500,
          keyframeTime: 40,
          keyframePath: '/tmp/s2.jpg',
        },
      ])
      .run();
    saveSceneEmbeddings(store, 'siglip', [
      { sceneId: 's1', vector: axis(SCENE_EMBEDDING_DIM, 0) },
      { sceneId: 's2', vector: axis(SCENE_EMBEDDING_DIM, 1) },
    ]);
  });

  afterEach(() => {
    store.$client.close();
  });

  it('returns transcript chunks closest first, with their video and segments', async () => {
    worker.embedDocuments.mockResolvedValue({
      model: 'bge-m3',
      dim: CHUNK_EMBEDDING_DIM,
      vectors: [axis(CHUNK_EMBEDDING_DIM, 1, 0.2)],
    });

    const res = await search.transcripts('weather', 2);

    expect(worker.embedDocuments).toHaveBeenCalledWith(
      ['weather'],
      expect.anything(),
    );
    expect(res.model).toBe('bge-m3');
    expect(res.hits.map((h) => h.chunk.id)).toEqual([2, 1]);
    const [top] = res.hits;
    expect(top.distance).toBeLessThan(res.hits[1].distance);
    expect(top.video).toEqual({ id: 'v1', title: 'Talk', channel: 'Chan' });
    expect(top.chunk).toMatchObject({
      start: 30,
      end: 60,
      text: 'about weather',
    });
    expect(top.segments.map((s) => s.index)).toEqual([2, 3]);
    expect(top.segments[0]).not.toHaveProperty('words');
  });

  it('returns scenes closest first, with keyframe URLs', async () => {
    worker.embedImageQueries.mockResolvedValue({
      model: 'siglip',
      dim: SCENE_EMBEDDING_DIM,
      vectors: [axis(SCENE_EMBEDDING_DIM, 0)],
    });

    const res = await search.scenes('a map', 1);

    expect(worker.embedImageQueries).toHaveBeenCalledWith(
      ['a map'],
      expect.anything(),
    );
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0].scene).toMatchObject({
      id: 's1',
      start: 0,
      end: 20,
      keyframeUrl: '/scenes/v1/s1/keyframe',
    });
    expect(res.hits[0].scene).not.toHaveProperty('keyframePath');
  });

  it('only compares vectors from the model that embedded the query', async () => {
    worker.embedDocuments.mockResolvedValue({
      model: 'some-other-model',
      dim: CHUNK_EMBEDDING_DIM,
      vectors: [axis(CHUNK_EMBEDDING_DIM, 0)],
    });

    expect((await search.transcripts('anything', 10)).hits).toEqual([]);
  });

  it('caps hits at k', async () => {
    worker.embedImageQueries.mockResolvedValue({
      model: 'siglip',
      dim: SCENE_EMBEDDING_DIM,
      vectors: [axis(SCENE_EMBEDDING_DIM, 0)],
    });

    expect((await search.scenes('x', 1)).hits).toHaveLength(1);
    expect((await search.scenes('x', 10)).hits).toHaveLength(2);
  });

  describe('scoped to a group or video', () => {
    // A second video whose chunk and scene sit closer to every test query
    // than anything in v1, so an unscoped top-1 always picks v2.
    beforeEach(() => {
      store
        .insert(videos)
        .values({ id: 'v2', title: 'Other', createdAt: now })
        .run();
      store
        .insert(transcriptions)
        .values({
          id: 't2',
          videoId: 'v2',
          language: 'en',
          languageProbability: 1,
          duration: 30,
          createdAt: now,
        })
        .run();
      store
        .insert(transcriptionChunks)
        .values({
          id: 3,
          transcriptionId: 't2',
          index: 0,
          startSegment: 0,
          endSegment: 0,
          start: 0,
          end: 30,
          text: 'other video',
        })
        .run();
      saveChunkEmbeddings(store, 'bge-m3', [
        { chunkId: 3, vector: axis(CHUNK_EMBEDDING_DIM, 5) },
      ]);
      store
        .insert(sceneDetections)
        .values({
          id: 'sd2',
          videoId: 'v2',
          detector: 'adaptive',
          fps: 25,
          duration: 30,
          sceneCount: 1,
          createdAt: now,
        })
        .run();
      store
        .insert(scenes)
        .values({
          id: 's3',
          sceneDetectionId: 'sd2',
          index: 0,
          start: 0,
          end: 30,
          startFrame: 0,
          endFrame: 750,
          keyframeTime: 5,
          keyframePath: '/tmp/s3.jpg',
        })
        .run();
      saveSceneEmbeddings(store, 'siglip', [
        { sceneId: 's3', vector: axis(SCENE_EMBEDDING_DIM, 5) },
      ]);

      worker.embedDocuments.mockResolvedValue({
        model: 'bge-m3',
        dim: CHUNK_EMBEDDING_DIM,
        vectors: [axis(CHUNK_EMBEDDING_DIM, 5, 0.1)],
      });
      worker.embedImageQueries.mockResolvedValue({
        model: 'siglip',
        dim: SCENE_EMBEDDING_DIM,
        vectors: [axis(SCENE_EMBEDDING_DIM, 5, 0.1)],
      });
    });

    it("finds the scope's matches even when every global top hit is elsewhere", async () => {
      expect((await search.transcripts('q', 1)).hits[0].video.id).toBe('v2');

      const group = await groups.create({ name: 'G', videoIds: ['v1'] });
      const inGroup = await search.transcripts('q', 1, { groupId: group.id });
      const inVideo = await search.scenes('q', 5, { videoId: 'v1' });

      expect(inGroup.hits.map((h) => h.video.id)).toEqual(['v1']);
      expect(inVideo.hits.map((h) => h.scene.id).sort()).toEqual(['s1', 's2']);
    });

    it('gives the same distances as the unscoped search', async () => {
      // Closer to chunk 2 than to chunk 1, so the order isn't a tie.
      const vector = Array.from({ length: CHUNK_EMBEDDING_DIM }, (_, i) =>
        i === 5 ? 1 : i === 1 ? 0.3 : i === 0 ? 0.1 : 0,
      );
      worker.embedDocuments.mockResolvedValue({
        model: 'bge-m3',
        dim: CHUNK_EMBEDDING_DIM,
        vectors: [vector],
      });
      const all = await search.transcripts('q', 10);
      const scoped = await search.transcripts('q', 10, { videoId: 'v1' });

      for (const hit of scoped.hits) {
        const same = all.hits.find((h) => h.chunk.id === hit.chunk.id)!;
        expect(hit.distance).toBeCloseTo(same.distance, 6);
      }
      expect(scoped.hits.map((h) => h.chunk.id)).toEqual(
        all.hits.filter((h) => h.video.id === 'v1').map((h) => h.chunk.id),
      );
    });

    it('narrows a group to one video, or to nothing if the video is not in it', async () => {
      const group = await groups.create({ name: 'G', videoIds: ['v1', 'v2'] });

      const both = await search.scenes('q', 10, {
        groupId: group.id,
        videoId: 'v2',
      });
      expect(both.hits.map((h) => h.scene.id)).toEqual(['s3']);

      await groups.update(group.id, { videoIds: ['v1'] });
      expect(
        (await search.scenes('q', 10, { groupId: group.id, videoId: 'v2' }))
          .hits,
      ).toEqual([]);
    });

    it('returns nothing for an empty group', async () => {
      const group = await groups.create({ name: 'Empty' });

      expect(
        (await search.transcripts('q', 10, { groupId: group.id })).hits,
      ).toEqual([]);
    });

    it('rejects an unknown group or video before calling the worker', async () => {
      await expect(
        search.transcripts('q', 10, { groupId: 'nope' }),
      ).rejects.toBeInstanceOf(SearchScopeNotFoundError);
      await expect(
        search.scenes('q', 10, { videoId: 'nope' }),
      ).rejects.toBeInstanceOf(SearchScopeNotFoundError);
      expect(worker.embedDocuments).not.toHaveBeenCalled();
      expect(worker.embedImageQueries).not.toHaveBeenCalled();
    });
  });
});

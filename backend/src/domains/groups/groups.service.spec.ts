import { eq } from 'drizzle-orm';
import { openStore, type Store } from '../../infra/store/client.js';
import { groups, groupVideos, videos } from '../../infra/store/schema/index.js';
import {
  GroupNotFoundError,
  GroupsService,
  UnknownVideosError,
} from './groups.service.js';

describe('GroupsService', () => {
  let store: Store;
  let service: GroupsService;

  beforeEach(() => {
    store = openStore(':memory:');
    service = new GroupsService(store);
    store
      .insert(videos)
      .values(
        ['v1', 'v2', 'v3'].map((id, i) => ({
          id,
          title: id,
          metadata: { big: true },
          createdAt: i,
        })),
      )
      .run();
  });

  afterEach(() => {
    store.$client.close();
  });

  describe('create', () => {
    it('creates a group with videos in the given order, without duplicates', async () => {
      const group = await service.create({
        name: 'Set',
        videoIds: ['v2', 'v1', 'v2'],
      });

      expect(group).toMatchObject({ name: 'Set', videoIds: ['v2', 'v1'] });
      expect(await service.findOne(group.id)).toEqual(group);
    });

    it('creates an empty group', async () => {
      expect((await service.create({ name: 'Empty' })).videoIds).toEqual([]);
    });

    it('rejects unknown videos and creates nothing', async () => {
      const err = await service
        .create({ name: 'Set', videoIds: ['v1', 'nope', 'gone'] })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(UnknownVideosError);
      expect((err as UnknownVideosError).videoIds).toEqual(['nope', 'gone']);
      expect(store.select().from(groups).all()).toEqual([]);
    });
  });

  describe('findMany', () => {
    it('pages newest first, each with its video ids', async () => {
      const a = await service.create({ name: 'A', videoIds: ['v1'] });
      const b = await service.create({ name: 'B', videoIds: ['v2', 'v3'] });
      const c = await service.create({ name: 'C' });

      const first = await service.findMany({ page: 1, pageSize: 2 });
      const second = await service.findMany({ page: 2, pageSize: 2 });

      expect(first.total).toBe(3);
      expect(first.items.map((g) => g.id)).toEqual([c.id, b.id]);
      expect(first.items[1].videoIds).toEqual(['v2', 'v3']);
      expect(second.items).toEqual([a]);
    });
  });

  describe('update', () => {
    it('renames without touching videos', async () => {
      const group = await service.create({ name: 'Old', videoIds: ['v1'] });

      const updated = await service.update(group.id, { name: 'New' });

      expect(updated).toMatchObject({ name: 'New', videoIds: ['v1'] });
    });

    it('replaces videos, keeping the added time of ones that stay', async () => {
      const group = await service.create({ name: 'G', videoIds: ['v1', 'v2'] });
      const before = store
        .select()
        .from(groupVideos)
        .where(eq(groupVideos.videoId, 'v2'))
        .get()!;

      const updated = await service.update(group.id, {
        videoIds: ['v2', 'v3'],
      });

      expect(updated.videoIds).toEqual(['v2', 'v3']);
      const after = store
        .select()
        .from(groupVideos)
        .where(eq(groupVideos.videoId, 'v2'))
        .get()!;
      expect(after.addedAt).toBe(before.addedAt);
    });

    it('can empty a group', async () => {
      const group = await service.create({ name: 'G', videoIds: ['v1'] });

      expect(
        (await service.update(group.id, { videoIds: [] })).videoIds,
      ).toEqual([]);
    });

    it('changes nothing when a video is unknown', async () => {
      const group = await service.create({ name: 'G', videoIds: ['v1'] });

      await expect(
        service.update(group.id, { name: 'X', videoIds: ['v2', 'nope'] }),
      ).rejects.toBeInstanceOf(UnknownVideosError);

      expect(await service.findOne(group.id)).toMatchObject({
        name: 'G',
        videoIds: ['v1'],
      });
    });

    it('rejects an unknown group', async () => {
      await expect(
        service.update('nope', { name: 'X' }),
      ).rejects.toBeInstanceOf(GroupNotFoundError);
    });
  });

  describe('remove', () => {
    it('deletes the group but keeps its videos', async () => {
      const group = await service.create({ name: 'G', videoIds: ['v1'] });

      await service.remove(group.id);

      expect(await service.findOne(group.id)).toBeNull();
      expect(store.select().from(groupVideos).all()).toEqual([]);
      expect(store.select().from(videos).all()).toHaveLength(3);
      await expect(service.remove(group.id)).rejects.toBeInstanceOf(
        GroupNotFoundError,
      );
    });
  });

  describe('membership', () => {
    it('adds videos, skipping ones already in the group', async () => {
      const group = await service.create({ name: 'G', videoIds: ['v1'] });

      const updated = await service.addVideos(group.id, ['v1', 'v3']);

      expect(updated.videoIds).toEqual(['v1', 'v3']);
    });

    it('removes one video', async () => {
      const group = await service.create({ name: 'G', videoIds: ['v1', 'v2'] });

      expect(await service.removeVideo(group.id, 'v1')).toBe(true);
      expect(await service.removeVideo(group.id, 'v1')).toBe(false);
      expect((await service.findOne(group.id))?.videoIds).toEqual(['v2']);
      await expect(service.removeVideo('nope', 'v1')).rejects.toBeInstanceOf(
        GroupNotFoundError,
      );
    });

    it('drops a deleted video from its groups', async () => {
      const group = await service.create({ name: 'G', videoIds: ['v1', 'v2'] });

      store.delete(videos).where(eq(videos.id, 'v1')).run();

      expect((await service.findOne(group.id))?.videoIds).toEqual(['v2']);
    });

    it('lists member videos in added order, without metadata', async () => {
      const group = await service.create({
        name: 'G',
        videoIds: ['v3', 'v1', 'v2'],
      });

      const page = await service.videos(group.id, { page: 1, pageSize: 2 });

      expect(page.total).toBe(3);
      expect(page.items.map((v) => v.id)).toEqual(['v3', 'v1']);
      expect(page.items[0]).not.toHaveProperty('metadata');
      await expect(
        service.videos('nope', { page: 1, pageSize: 2 }),
      ).rejects.toBeInstanceOf(GroupNotFoundError);
    });
  });
});

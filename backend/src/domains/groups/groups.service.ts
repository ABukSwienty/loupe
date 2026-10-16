import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  sql,
} from 'drizzle-orm';
import {
  toOffset,
  type Page,
  type PageRequest,
} from '../../common/pagination.js';
import type { Store } from '../../infra/store/client.js';
import { groups, groupVideos, videos } from '../../infra/store/schema/index.js';
import { STORE } from '../../infra/store/store.module.js';
import type { VideoSummary } from '../videos/video.model.js';
import { toGroup, type Group } from './group.model.js';

export class GroupNotFoundError extends Error {}

/** Some of the given video ids don't exist. Nothing was changed. */
export class UnknownVideosError extends Error {
  constructor(readonly videoIds: string[]) {
    super(`Unknown video ids: ${videoIds.join(', ')}`);
  }
}

type Tx = Parameters<Parameters<Store['transaction']>[0]>[0];

@Injectable()
export class GroupsService {
  constructor(@Inject(STORE) private readonly store: Store) {}

  async create(data: { name: string; videoIds?: string[] }): Promise<Group> {
    const id = randomUUID();
    this.store.transaction((tx) => {
      const videoIds = this.checkVideos(tx, data.videoIds ?? []);
      tx.insert(groups)
        .values({ id, name: data.name, createdAt: Date.now() })
        .run();
      this.addMembers(tx, id, videoIds);
    });
    return (await this.findOne(id))!;
  }

  async findOne(id: string): Promise<Group | null> {
    const row = this.store.select().from(groups).where(eq(groups.id, id)).get();
    return row ? toGroup(row, this.memberIds(this.store, id)) : null;
  }

  /** Newest first, each with its video ids. */
  async findMany(request: PageRequest): Promise<Page<Group>> {
    const { offset, limit } = toOffset(request);
    const rows = this.store
      .select()
      .from(groups)
      .orderBy(desc(groups.createdAt), desc(sql`rowid`))
      .limit(limit)
      .offset(offset)
      .all();
    const { total } = this.store.select({ total: count() }).from(groups).get()!;

    const members = new Map<string, string[]>(rows.map((g) => [g.id, []]));
    if (rows.length > 0) {
      const links = this.store
        .select({ groupId: groupVideos.groupId, videoId: groupVideos.videoId })
        .from(groupVideos)
        .where(
          inArray(
            groupVideos.groupId,
            rows.map((g) => g.id),
          ),
        )
        .orderBy(asc(groupVideos.addedAt), asc(sql`rowid`))
        .all();
      for (const { groupId, videoId } of links) {
        members.get(groupId)!.push(videoId);
      }
    }

    return {
      items: rows.map((row) => toGroup(row, members.get(row.id)!)),
      total,
      ...request,
    };
  }

  /** Renames the group and/or replaces its videos. Videos kept keep their added time. */
  async update(
    id: string,
    data: { name?: string; videoIds?: string[] },
  ): Promise<Group> {
    this.store.transaction((tx) => {
      this.requireGroup(tx, id);
      if (data.name !== undefined) {
        tx.update(groups)
          .set({ name: data.name })
          .where(eq(groups.id, id))
          .run();
      }
      if (data.videoIds !== undefined) {
        const wanted = this.checkVideos(tx, data.videoIds);
        const current = new Set(this.memberIds(tx, id));
        const removed = [...current].filter((v) => !wanted.includes(v));
        if (removed.length > 0) {
          tx.delete(groupVideos)
            .where(
              and(
                eq(groupVideos.groupId, id),
                inArray(groupVideos.videoId, removed),
              ),
            )
            .run();
        }
        this.addMembers(
          tx,
          id,
          wanted.filter((v) => !current.has(v)),
        );
      }
    });
    return (await this.findOne(id))!;
  }

  /** Deletes the group and its memberships; the videos stay. */
  async remove(id: string): Promise<void> {
    const { changes } = this.store
      .delete(groups)
      .where(eq(groups.id, id))
      .run();
    if (changes === 0) throw new GroupNotFoundError(`Group ${id} not found`);
  }

  /** Adds videos to the group. Ones already in it are left as they are. */
  async addVideos(id: string, videoIds: string[]): Promise<Group> {
    this.store.transaction((tx) => {
      this.requireGroup(tx, id);
      const current = new Set(this.memberIds(tx, id));
      this.addMembers(
        tx,
        id,
        this.checkVideos(tx, videoIds).filter((v) => !current.has(v)),
      );
    });
    return (await this.findOne(id))!;
  }

  /** Removes one video from the group. Returns false if it wasn't in it. */
  async removeVideo(id: string, videoId: string): Promise<boolean> {
    return this.store.transaction((tx) => {
      this.requireGroup(tx, id);
      return (
        tx
          .delete(groupVideos)
          .where(
            and(eq(groupVideos.groupId, id), eq(groupVideos.videoId, videoId)),
          )
          .run().changes > 0
      );
    });
  }

  /** The group's videos in the order they were added, without metadata. */
  async videos(id: string, request: PageRequest): Promise<Page<VideoSummary>> {
    this.requireGroup(this.store, id);
    const { metadata: _, ...columns } = getTableColumns(videos);
    const { offset, limit } = toOffset(request);
    const items = this.store
      .select(columns)
      .from(groupVideos)
      .innerJoin(videos, eq(groupVideos.videoId, videos.id))
      .where(eq(groupVideos.groupId, id))
      .orderBy(asc(groupVideos.addedAt), asc(sql`group_videos.rowid`))
      .limit(limit)
      .offset(offset)
      .all();
    const { total } = this.store
      .select({ total: count() })
      .from(groupVideos)
      .where(eq(groupVideos.groupId, id))
      .get()!;
    return { items, total, ...request };
  }

  private requireGroup(db: Store | Tx, id: string) {
    const row = db
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.id, id))
      .get();
    if (!row) throw new GroupNotFoundError(`Group ${id} not found`);
  }

  /** Deduplicates the ids, keeping their order, and throws if any don't exist. */
  private checkVideos(db: Store | Tx, videoIds: string[]): string[] {
    const unique = [...new Set(videoIds)];
    if (unique.length === 0) return unique;
    const found = new Set(
      db
        .select({ id: videos.id })
        .from(videos)
        .where(inArray(videos.id, unique))
        .all()
        .map((v) => v.id),
    );
    const missing = unique.filter((v) => !found.has(v));
    if (missing.length > 0) throw new UnknownVideosError(missing);
    return unique;
  }

  private memberIds(db: Store | Tx, id: string): string[] {
    return db
      .select({ videoId: groupVideos.videoId })
      .from(groupVideos)
      .where(eq(groupVideos.groupId, id))
      .orderBy(asc(groupVideos.addedAt), asc(sql`rowid`))
      .all()
      .map((r) => r.videoId);
  }

  private addMembers(db: Store | Tx, id: string, videoIds: string[]) {
    if (videoIds.length === 0) return;
    const now = Date.now();
    db.insert(groupVideos)
      .values(
        videoIds.map((videoId) => ({ groupId: id, videoId, addedAt: now })),
      )
      .run();
  }
}

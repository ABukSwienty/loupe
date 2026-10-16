import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { count, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import {
  toOffset,
  type Page,
  type PageRequest,
} from '../../common/pagination.js';
import { JOB_QUEUE, type JobQueue } from '../../infra/queue/interface.js';
import { JobState } from '../../infra/queue/job.model.js';
import type { Store } from '../../infra/store/client.js';
import { videos } from '../../infra/store/schema/index.js';
import { STORE } from '../../infra/store/store.module.js';
import {
  YT_DLP,
  type VideoInfo,
  type YtDlp,
} from '../../infra/yt-dlp/interface.js';
import type { Video, VideoSummary } from './video.model.js';
import { canonicalYoutubeUrl } from './youtube-url.js';

export const DOWNLOAD_JOB = 'video.download';

export type DownloadJobInput = { videoId: string };

/** The URL is not a YouTube video link. */
export class InvalidVideoUrlError extends Error {}

/** yt-dlp could read the link but the video cannot be ingested, e.g. a live stream. */
export class UnsupportedVideoError extends Error {}

// Large, per-request parts of the info dict that are not worth storing.
const DROPPED_INFO_KEYS = [
  'formats',
  'requested_formats',
  'requested_downloads',
  'thumbnails',
  'automatic_captions',
  'subtitles',
  'heatmap',
  '_format_sort_fields',
];

@Injectable()
export class VideosService {
  /** Where downloaded media is written. */
  mediaDir = process.env.MEDIA_DIR ?? 'data/media';
  /** Height cap for the low-resolution copy. */
  lowResHeight = Number(process.env.LOW_RES_HEIGHT ?? 720);

  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(YT_DLP) private readonly ytDlp: YtDlp,
  ) {}

  async findOne(id: string): Promise<Video | null> {
    return (
      this.store.select().from(videos).where(eq(videos.id, id)).get() ?? null
    );
  }

  /** A page of videos, newest first, without the metadata blob. */
  async findMany(request: PageRequest): Promise<Page<VideoSummary>> {
    const { metadata: _, ...columns } = getTableColumns(videos);
    const { offset, limit } = toOffset(request);
    const items = this.store
      .select(columns)
      .from(videos)
      .orderBy(desc(videos.createdAt), desc(sql`rowid`))
      .limit(limit)
      .offset(offset)
      .all();
    const { total } = this.store.select({ total: count() }).from(videos).get()!;
    return { items, total, ...request };
  }

  /**
   * Stores a YouTube video's metadata and queues the download of its
   * low-resolution copy. Ingesting a URL twice returns the existing video, and
   * queues the download again only if it has no file and no download pending.
   */
  async ingest(
    url: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ video: Video; created: boolean; jobId: string | null }> {
    const sourceUrl = canonicalYoutubeUrl(url);
    if (!sourceUrl) {
      throw new InvalidVideoUrlError(`Not a YouTube video URL: ${url}`);
    }

    let video = this.findBySourceUrl(sourceUrl);
    let created = false;
    if (!video) {
      const info = await this.ytDlp.fetchInfo(sourceUrl, options);
      if (
        info.live_status === 'is_live' ||
        info.live_status === 'is_upcoming'
      ) {
        throw new UnsupportedVideoError(
          'Live and upcoming streams cannot be ingested',
        );
      }

      // A concurrent ingest of the same URL may have inserted it meanwhile.
      const inserted = this.store
        .insert(videos)
        .values({ ...fromInfo(info), id: randomUUID(), sourceUrl })
        .onConflictDoNothing({ target: videos.sourceUrl })
        .returning()
        .get();
      created = inserted !== undefined;
      video = inserted ?? this.findBySourceUrl(sourceUrl)!;
    }

    const jobId =
      video.lowResPath === null && !(await this.hasPendingDownload(video.id))
        ? (
            await this.queue.create({
              name: DOWNLOAD_JOB,
              input: { videoId: video.id } satisfies DownloadJobInput,
            })
          ).id
        : null;

    return { video, created, jobId };
  }

  /** Job handler: downloads the low-resolution copy and records its path. */
  async download(
    { videoId }: DownloadJobInput,
    signal?: AbortSignal,
  ): Promise<{ lowResPath: string } | null> {
    const video = await this.findOne(videoId);
    if (!video) return null; // deleted since the job was queued
    if (video.lowResPath && existsSync(video.lowResPath)) {
      return { lowResPath: video.lowResPath };
    }
    if (!video.sourceUrl) {
      throw new Error(`Video ${videoId} has no source URL to download from`);
    }

    const dir = resolve(this.mediaDir);
    await mkdir(dir, { recursive: true });
    const outBase = join(dir, `${video.id}.low`);

    let lowResPath: string;
    try {
      lowResPath = await this.ytDlp.download(video.sourceUrl, outBase, {
        maxHeight: this.lowResHeight,
        signal,
      });
    } catch (err) {
      await removeFiles(dir, `${video.id}.low.`); // .part and unmerged streams
      throw err;
    }

    this.store
      .update(videos)
      .set({ lowResPath })
      .where(eq(videos.id, video.id))
      .run();
    return { lowResPath };
  }

  private findBySourceUrl(sourceUrl: string): Video | undefined {
    return this.store
      .select()
      .from(videos)
      .where(eq(videos.sourceUrl, sourceUrl))
      .get();
  }

  private async hasPendingDownload(videoId: string): Promise<boolean> {
    for (const state of [JobState.Queued, JobState.Processing]) {
      const jobs = await this.queue.findMany({ name: DOWNLOAD_JOB, state });
      if (jobs.some((j) => (j.input as DownloadJobInput).videoId === videoId)) {
        return true;
      }
    }
    return false;
  }
}

function fromInfo(info: VideoInfo) {
  const metadata = { ...info };
  for (const key of DROPPED_INFO_KEYS) delete metadata[key];

  return {
    platform: info.extractor,
    externalId: info.id,
    title: info.title,
    channel: info.channel ?? null,
    channelId: info.channel_id ?? null,
    description: info.description ?? null,
    publishedAt: publishedAt(info),
    duration: info.duration ?? null,
    metadata,
    createdAt: Date.now(),
  };
}

/** Unix milliseconds, from the exact timestamp or else the upload day (UTC). */
function publishedAt(info: VideoInfo): number | null {
  if (typeof info.timestamp === 'number') return info.timestamp * 1000;
  const m = info.upload_date?.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}

async function removeFiles(dir: string, prefix: string) {
  const names = await readdir(dir).catch(() => []);
  await Promise.all(
    names
      .filter((n) => n.startsWith(prefix))
      .map((n) => rm(join(dir, n), { force: true })),
  );
}

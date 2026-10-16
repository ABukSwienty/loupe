import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobState } from '../../infra/queue/job.model.js';
import { QueueService } from '../../infra/queue/queue.service.js';
import { openStore, type Store } from '../../infra/store/client.js';
import { videos } from '../../infra/store/schema/index.js';
import type { VideoInfo, YtDlp } from '../../infra/yt-dlp/interface.js';
import {
  DOWNLOAD_JOB,
  InvalidVideoUrlError,
  UnsupportedVideoError,
  VideosService,
} from './videos.service.js';

const info: VideoInfo = {
  id: 'jNQXAC9IVRw',
  title: 'Me at the zoo',
  extractor: 'youtube',
  webpage_url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  channel: 'jawed',
  channel_id: 'UC4QobU6STFB0P71PMvOGN5A',
  description: 'elephants',
  timestamp: 1114313512,
  upload_date: '20050424',
  duration: 19,
  live_status: 'not_live',
  formats: [{ format_id: '18' }],
  tags: ['zoo'],
};

describe('VideosService', () => {
  let store: Store;
  let queue: QueueService;
  let ytDlp: {
    fetchInfo: ReturnType<typeof vi.fn>;
    download: ReturnType<typeof vi.fn>;
  };
  let service: VideosService;
  let mediaDir: string;

  beforeEach(() => {
    store = openStore(':memory:');
    queue = new QueueService(store);
    ytDlp = {
      fetchInfo: vi.fn(async () => info),
      download: vi.fn(async (_url: string, outBase: string) => {
        writeFileSync(`${outBase}.mp4`, 'video');
        return `${outBase}.mp4`;
      }),
    };
    service = new VideosService(store, queue, ytDlp as YtDlp);
    mediaDir = mkdtempSync(join(tmpdir(), 'loupe-media-'));
    service.mediaDir = mediaDir;
  });

  afterEach(() => {
    store.$client.close();
    rmSync(mediaDir, { recursive: true, force: true });
  });

  describe('ingest', () => {
    it('stores the metadata and queues a download', async () => {
      const { video, created, jobId } = await service.ingest(
        'https://youtu.be/jNQXAC9IVRw?si=abc',
      );

      expect(created).toBe(true);
      expect(video).toMatchObject({
        sourceUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
        platform: 'youtube',
        externalId: 'jNQXAC9IVRw',
        title: 'Me at the zoo',
        channel: 'jawed',
        publishedAt: 1114313512000,
        duration: 19,
        lowResPath: null,
      });
      expect(video.metadata).toMatchObject({ tags: ['zoo'] });
      expect(video.metadata).not.toHaveProperty('formats');

      const job = await queue.findOne(jobId!);
      expect(job).toMatchObject({
        name: DOWNLOAD_JOB,
        input: { videoId: video.id },
      });
    });

    it('returns the existing video for the same video under another URL', async () => {
      const first = await service.ingest(
        'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      );
      const second = await service.ingest(
        'https://www.youtube.com/shorts/jNQXAC9IVRw',
      );

      expect(second.created).toBe(false);
      expect(second.video.id).toBe(first.video.id);
      expect(second.jobId).toBeNull(); // first download still queued
      expect(ytDlp.fetchInfo).toHaveBeenCalledTimes(1);
    });

    it('queues a new download if the earlier one failed', async () => {
      const first = await service.ingest('https://youtu.be/jNQXAC9IVRw');
      await queue.claim();
      await queue.fail(first.jobId!, 'boom');
      await queue.claim();
      await queue.fail(first.jobId!, 'boom');
      await queue.claim();
      await queue.fail(first.jobId!, 'boom');
      expect((await queue.findOne(first.jobId!))?.state).toBe(JobState.Failed);

      const second = await service.ingest('https://youtu.be/jNQXAC9IVRw');

      expect(second.jobId).not.toBeNull();
      expect(second.jobId).not.toBe(first.jobId);
    });

    it('rejects non-YouTube URLs without calling yt-dlp', async () => {
      await expect(service.ingest('https://vimeo.com/1')).rejects.toThrow(
        InvalidVideoUrlError,
      );
      expect(ytDlp.fetchInfo).not.toHaveBeenCalled();
    });

    it('rejects live streams', async () => {
      ytDlp.fetchInfo.mockResolvedValue({ ...info, live_status: 'is_live' });

      await expect(
        service.ingest('https://youtu.be/jNQXAC9IVRw'),
      ).rejects.toThrow(UnsupportedVideoError);
    });
  });

  describe('findMany', () => {
    const add = (id: string, createdAt: number) =>
      store
        .insert(videos)
        .values({ id, title: id, metadata: { big: true }, createdAt })
        .run();

    it('pages newest first, with a total and without metadata', async () => {
      add('a', 1);
      add('b', 2);
      add('c', 3);

      const first = await service.findMany({ page: 1, pageSize: 2 });
      const second = await service.findMany({ page: 2, pageSize: 2 });

      expect(first).toMatchObject({ total: 3, page: 1, pageSize: 2 });
      expect(first.items.map((v) => v.id)).toEqual(['c', 'b']);
      expect(second.items.map((v) => v.id)).toEqual(['a']);
      expect(first.items[0]).not.toHaveProperty('metadata');
    });

    it('returns an empty page past the end', async () => {
      add('a', 1);

      const page = await service.findMany({ page: 5, pageSize: 20 });

      expect(page).toEqual({ items: [], total: 1, page: 5, pageSize: 20 });
    });
  });

  describe('download', () => {
    it('downloads the low-res copy and records its path', async () => {
      const { video } = await service.ingest('https://youtu.be/jNQXAC9IVRw');

      const output = await service.download({ videoId: video.id });

      const expected = join(mediaDir, `${video.id}.low.mp4`);
      expect(output).toEqual({ lowResPath: expected });
      expect(ytDlp.download).toHaveBeenCalledWith(
        'https://www.youtube.com/watch?v=jNQXAC9IVRw',
        join(mediaDir, `${video.id}.low`),
        { maxHeight: 720, signal: undefined },
      );
      expect((await service.findOne(video.id))?.lowResPath).toBe(expected);
    });

    it('skips the download when the file is already there', async () => {
      const { video } = await service.ingest('https://youtu.be/jNQXAC9IVRw');
      await service.download({ videoId: video.id });

      await service.download({ videoId: video.id });

      expect(ytDlp.download).toHaveBeenCalledTimes(1);
    });

    it('removes partial files when the download fails', async () => {
      const { video } = await service.ingest('https://youtu.be/jNQXAC9IVRw');
      ytDlp.download.mockImplementation(
        async (_url: string, outBase: string) => {
          writeFileSync(`${outBase}.f395.webm.part`, 'partial');
          throw new Error('network down');
        },
      );

      await expect(service.download({ videoId: video.id })).rejects.toThrow(
        'network down',
      );
      expect(readdirSync(mediaDir)).toEqual([]);
      expect((await service.findOne(video.id))?.lowResPath).toBeNull();
    });

    it('does nothing for a deleted video', async () => {
      expect(await service.download({ videoId: 'missing' })).toBeNull();
      expect(ytDlp.download).not.toHaveBeenCalled();
    });
  });
});

import { openStore, type Store } from '../store/client.js';
import { JobState } from './job.model.js';
import { QueueService } from './queue.service.js';

describe('QueueService list and counts', () => {
  let store: Store;
  let queue: QueueService;

  beforeEach(() => {
    store = openStore(':memory:');
    queue = new QueueService(store);
  });

  afterEach(() => {
    store.$client.close();
  });

  const page = (order: 'queue' | 'newest', offset = 0, limit = 10) => ({
    offset,
    limit,
    order,
  });

  it('lists queued jobs in run order, including retries at the back', async () => {
    const a = await queue.create({ name: 'x', input: {} });
    const b = await queue.create({ name: 'x', input: {} });
    await queue.claim();
    await queue.fail(a.id, 'boom'); // requeued behind b

    const { items } = await queue.list(
      { state: JobState.Queued },
      page('queue'),
    );

    expect(items.map((j) => j.id)).toEqual([b.id, a.id]);
  });

  it('lists newest first and pages with a total', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push((await queue.create({ name: 'x', input: {} })).id);
    }

    const first = await queue.list({}, page('newest', 0, 2));
    const last = await queue.list({}, page('newest', 4, 2));

    expect(first.total).toBe(5);
    expect(first.items.map((j) => j.id)).toEqual([ids[4], ids[3]]);
    expect(last.items.map((j) => j.id)).toEqual([ids[0]]);
  });

  it('filters by name, state and input.videoId', async () => {
    const v1 = await queue.create({ name: 'scenes', input: { videoId: 'v1' } });
    await queue.create({ name: 'scenes', input: { videoId: 'v2' } });
    const other = await queue.create({ name: 'ocr', input: { videoId: 'v1' } });
    await queue.claim(['ocr']);

    const byVideo = await queue.list({ videoId: 'v1' }, page('newest'));
    expect(byVideo.items.map((j) => j.id)).toEqual([other.id, v1.id]);
    expect(byVideo.total).toBe(2);

    const running = await queue.list(
      { state: JobState.Processing },
      page('newest'),
    );
    expect(running.items.map((j) => j.id)).toEqual([other.id]);

    const scenes = await queue.list(
      { name: 'scenes', videoId: 'v1' },
      page('newest'),
    );
    expect(scenes.items.map((j) => j.id)).toEqual([v1.id]);
  });

  it('counts jobs per state, with zeros for empty states', async () => {
    await queue.create({ name: 'x', input: {} });
    await queue.create({ name: 'x', input: {} });
    const job = await queue.claim();
    await queue.complete(job!.id, null);

    expect(await queue.countByState()).toEqual({
      queued: 1,
      processing: 0,
      failed: 0,
      completed: 1,
    });
  });
});

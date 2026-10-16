import { openStore, type Store } from '../store/client.js';
import { JobState } from './job.model.js';
import { QueueService } from './queue.service.js';

describe('QueueService', () => {
  let store: Store;
  let queue: QueueService;

  beforeEach(() => {
    store = openStore(':memory:');
    queue = new QueueService(store);
  });

  afterEach(() => {
    store.$client.close();
  });

  it('creates and finds jobs', async () => {
    const job = await queue.create({
      name: 'transcribe',
      input: { path: 'a' },
    });

    expect(job.state).toBe(JobState.Queued);
    expect(job.output).toBeNull();
    expect(await queue.findOne(job.id)).toEqual(job);
    expect(await queue.findOne('missing')).toBeNull();
  });

  it('notifies listeners on create until unsubscribed', async () => {
    const listener = vi.fn();
    const unsubscribe = queue.onCreated(listener);

    const job = await queue.create({ name: 'transcribe', input: {} });
    unsubscribe();
    await queue.create({ name: 'transcribe', input: {} });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(job);
  });

  it('filters findMany by name and state', async () => {
    const a = await queue.create({ name: 'transcribe', input: {} });
    const b = await queue.create({ name: 'diarize', input: {} });
    await queue.claim(['diarize']);

    expect((await queue.findMany({})).map((j) => j.id)).toEqual([a.id, b.id]);
    expect(
      (await queue.findMany({ name: 'transcribe' })).map((j) => j.id),
    ).toEqual([a.id]);
    expect(
      (await queue.findMany({ state: JobState.Processing })).map((j) => j.id),
    ).toEqual([b.id]);
  });

  it('claims the oldest queued job, once', async () => {
    const first = await queue.create({ name: 'transcribe', input: {} });
    const second = await queue.create({ name: 'transcribe', input: {} });

    const claimed = await queue.claim();
    expect(claimed?.id).toBe(first.id);
    expect(claimed?.state).toBe(JobState.Processing);
    expect(claimed?.processedAt).not.toBeNull();

    expect((await queue.claim())?.id).toBe(second.id);
    expect(await queue.claim()).toBeNull();
  });

  it('claims by name', async () => {
    await queue.create({ name: 'transcribe', input: {} });
    const diarize = await queue.create({ name: 'diarize', input: {} });

    expect((await queue.claim(['diarize']))?.id).toBe(diarize.id);
    expect(await queue.claim(['diarize'])).toBeNull();
  });

  it('completes and fails only processing jobs', async () => {
    const a = await queue.create({ name: 'transcribe', input: {} });
    const b = await queue.create({ name: 'transcribe', input: {} });

    expect(await queue.complete(a.id, { text: 'hi' })).toBeNull();

    await queue.claim();
    await queue.claim();

    const done = await queue.complete(a.id, { text: 'hi' });
    expect(done?.state).toBe(JobState.Completed);
    expect(done?.output).toEqual({ text: 'hi' });
    expect(done?.completedAt).not.toBeNull();

    const failed = await queue.fail(b.id, 'out of memory');
    expect(failed?.state).toBe(JobState.Queued);
    expect(failed?.error).toBe('out of memory');

    expect(await queue.fail(a.id, 'too late')).toBeNull();
  });

  it('counts attempts on claim', async () => {
    const job = await queue.create({ name: 'transcribe', input: {} });
    expect(job.attempts).toBe(0);
    expect(job.maxAttempts).toBe(3);

    expect((await queue.claim())?.attempts).toBe(1);
  });

  it('requeues failures until attempts run out', async () => {
    const job = await queue.create({ name: 'transcribe', input: {} });

    for (const expected of [
      JobState.Queued,
      JobState.Queued,
      JobState.Failed,
    ]) {
      await queue.claim();
      const failed = await queue.fail(job.id, 'worker unreachable');
      expect(failed?.state).toBe(expected);
    }

    const final = await queue.findOne(job.id);
    expect(final?.attempts).toBe(3);
    expect(final?.completedAt).not.toBeNull();
    expect(await queue.claim()).toBeNull();
  });

  it('puts a retried job at the back of the queue', async () => {
    const flaky = await queue.create({ name: 'transcribe', input: {} });
    const other = await queue.create({ name: 'transcribe', input: {} });

    await queue.claim();
    await queue.fail(flaky.id, 'worker unreachable');

    expect((await queue.claim())?.id).toBe(other.id);
    expect((await queue.claim())?.id).toBe(flaky.id);
  });

  it('keeps the queue position of stale jobs', async () => {
    const stale = await queue.create({ name: 'transcribe', input: {} });
    const other = await queue.create({ name: 'transcribe', input: {} });
    await queue.claim();

    await queue.requeueStale();

    expect((await queue.claim())?.id).toBe(stale.id);
    expect((await queue.claim())?.id).toBe(other.id);
  });

  it('clears the last error on completion after a retry', async () => {
    const job = await queue.create({ name: 'transcribe', input: {} });
    await queue.claim();
    await queue.fail(job.id, 'worker unreachable');
    await queue.claim();

    const done = await queue.complete(job.id, null);
    expect(done?.state).toBe(JobState.Completed);
    expect(done?.error).toBeNull();
    expect(done?.attempts).toBe(2);
  });

  it('honours a custom maxAttempts', async () => {
    const job = await queue.create({
      name: 'transcribe',
      input: {},
      maxAttempts: 1,
    });
    await queue.claim();

    expect((await queue.fail(job.id, 'boom'))?.state).toBe(JobState.Failed);
  });

  it('requeues stale processing jobs', async () => {
    const job = await queue.create({ name: 'transcribe', input: {} });
    await queue.claim();

    expect(await queue.requeueStale()).toEqual({ requeued: 1, failed: 0 });
    const requeued = await queue.findOne(job.id);
    expect(requeued?.state).toBe(JobState.Queued);
    expect(requeued?.processedAt).toBeNull();
  });

  it('fails stale jobs that were on their last attempt', async () => {
    const job = await queue.create({
      name: 'transcribe',
      input: {},
      maxAttempts: 1,
    });
    await queue.claim();

    expect(await queue.requeueStale()).toEqual({ requeued: 0, failed: 1 });
    const failed = await queue.findOne(job.id);
    expect(failed?.state).toBe(JobState.Failed);
    expect(failed?.error).toBe('Interrupted on its last attempt');
  });
});

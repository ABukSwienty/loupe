import { openStore, type Store } from '../store/client.js';
import { JobState } from './job.model.js';
import { QueueRunner } from './queue.runner.js';
import { QueueService } from './queue.service.js';

describe('QueueRunner', () => {
  let store: Store;
  let queue: QueueService;
  let runner: QueueRunner;

  beforeEach(() => {
    store = openStore(':memory:');
    queue = new QueueService(store);
    runner = new QueueRunner(queue);
    runner.claimRetryDelaysMs = [1, 1, 1];
  });

  afterEach(async () => {
    await runner.stop();
    store.$client.close();
  });

  const stateOf = async (id: string) => (await queue.findOne(id))?.state;

  it('runs jobs and stores their output', async () => {
    runner.register('double', async (input: { n: number }) => ({
      n: input.n * 2,
    }));
    const job = await queue.create({ name: 'double', input: { n: 21 } });

    await runner.start();

    await vi.waitFor(async () =>
      expect(await stateOf(job.id)).toBe(JobState.Completed),
    );
    expect((await queue.findOne(job.id))?.output).toEqual({ n: 42 });
  });

  it('picks up jobs created after start', async () => {
    runner.register('noop', async () => null);
    await runner.start();

    const job = await queue.create({ name: 'noop', input: {} });

    await vi.waitFor(async () =>
      expect(await stateOf(job.id)).toBe(JobState.Completed),
    );
  });

  it('retries a failing handler until attempts run out, and keeps going', async () => {
    const boom = vi.fn(async () => {
      throw new Error('out of memory');
    });
    runner.register('boom', boom);
    runner.register('noop', async () => null);
    const bad = await queue.create({ name: 'boom', input: {} });
    const good = await queue.create({ name: 'noop', input: {} });

    await runner.start();

    await vi.waitFor(async () =>
      expect(await stateOf(good.id)).toBe(JobState.Completed),
    );
    const failed = await queue.findOne(bad.id);
    expect(failed?.state).toBe(JobState.Failed);
    expect(failed?.error).toBe('out of memory');
    expect(failed?.attempts).toBe(3);
    expect(boom).toHaveBeenCalledTimes(3);
  });

  it('runs other queued jobs before retrying a failed one', async () => {
    const order: string[] = [];
    runner.register('flaky', async () => {
      order.push('flaky');
      if (order.length === 1) throw new Error('worker unreachable');
      return null;
    });
    runner.register('noop', async () => {
      order.push('noop');
      return null;
    });
    const flaky = await queue.create({ name: 'flaky', input: {} });
    await queue.create({ name: 'noop', input: {} });

    await runner.start();

    await vi.waitFor(async () =>
      expect(await stateOf(flaky.id)).toBe(JobState.Completed),
    );
    expect(order).toEqual(['flaky', 'noop', 'flaky']);
  });

  it('completes a job that succeeds on a retry', async () => {
    const flaky = vi
      .fn()
      .mockRejectedValueOnce(new Error('worker unreachable'))
      .mockResolvedValueOnce({ ok: true });
    runner.register('flaky', flaky);
    const job = await queue.create({ name: 'flaky', input: {} });

    await runner.start();

    await vi.waitFor(async () =>
      expect(await stateOf(job.id)).toBe(JobState.Completed),
    );
    const done = await queue.findOne(job.id);
    expect(done?.attempts).toBe(2);
    expect(done?.output).toEqual({ ok: true });
  });

  it('retries a failed claim', async () => {
    runner.register('noop', async () => null);
    const claim = vi
      .spyOn(queue, 'claim')
      .mockRejectedValueOnce(new Error('database is locked'))
      .mockRejectedValueOnce(new Error('database is locked'));
    const job = await queue.create({ name: 'noop', input: {} });

    await runner.start();

    await vi.waitFor(async () =>
      expect(await stateOf(job.id)).toBe(JobState.Completed),
    );
    expect(claim.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('gives up claiming after the retries and resumes on the next wake-up', async () => {
    runner.register('noop', async () => null);
    const locked = new Error('database is locked');
    const claim = vi
      .spyOn(queue, 'claim')
      .mockRejectedValueOnce(locked)
      .mockRejectedValueOnce(locked)
      .mockRejectedValueOnce(locked)
      .mockRejectedValueOnce(locked);
    const first = await queue.create({ name: 'noop', input: {} });

    await runner.start();
    await vi.waitFor(() => expect(claim).toHaveBeenCalledTimes(4));
    await new Promise((r) => setTimeout(r, 10));
    expect(await stateOf(first.id)).toBe(JobState.Queued);

    const second = await queue.create({ name: 'noop', input: {} });

    await vi.waitFor(async () => {
      expect(await stateOf(first.id)).toBe(JobState.Completed);
      expect(await stateOf(second.id)).toBe(JobState.Completed);
    });
  });

  it('leaves jobs without a handler queued', async () => {
    runner.register('noop', async () => null);
    const orphan = await queue.create({ name: 'unknown', input: {} });
    const job = await queue.create({ name: 'noop', input: {} });

    await runner.start();

    await vi.waitFor(async () =>
      expect(await stateOf(job.id)).toBe(JobState.Completed),
    );
    expect(await stateOf(orphan.id)).toBe(JobState.Queued);
  });

  it('runs one job at a time', async () => {
    let running = 0;
    let maxRunning = 0;
    runner.register('slow', async () => {
      maxRunning = Math.max(maxRunning, ++running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return null;
    });
    const jobs = await Promise.all(
      [1, 2, 3].map(() => queue.create({ name: 'slow', input: {} })),
    );

    await runner.start();

    await vi.waitFor(async () => {
      for (const job of jobs) {
        expect(await stateOf(job.id)).toBe(JobState.Completed);
      }
    });
    expect(maxRunning).toBe(1);
  });

  it('requeues stale jobs on start', async () => {
    runner.register('noop', async () => null);
    const job = await queue.create({ name: 'noop', input: {} });
    await queue.claim();

    await runner.start();

    await vi.waitFor(async () =>
      expect(await stateOf(job.id)).toBe(JobState.Completed),
    );
  });

  it('leaves an interrupted job processing on stop', async () => {
    let started = false;
    runner.register('wait', (_input, { signal }) => {
      started = true;
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason)),
      );
    });
    const job = await queue.create({ name: 'wait', input: {} });

    await runner.start();
    await vi.waitFor(() => expect(started).toBe(true));
    await runner.stop();

    expect(await stateOf(job.id)).toBe(JobState.Processing);
  });

  it('does not check the queue while idle', async () => {
    runner.register('noop', async () => null);
    const claim = vi.spyOn(queue, 'claim');

    await runner.start();
    await vi.waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));

    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('drains jobs created while another job is running', async () => {
    let release!: () => void;
    runner.register(
      'gate',
      () => new Promise<null>((r) => (release = () => r(null))),
    );
    runner.register('noop', async () => null);
    const first = await queue.create({ name: 'gate', input: {} });

    await runner.start();
    await vi.waitFor(async () =>
      expect(await stateOf(first.id)).toBe(JobState.Processing),
    );
    const second = await queue.create({ name: 'noop', input: {} });
    release();

    await vi.waitFor(async () =>
      expect(await stateOf(second.id)).toBe(JobState.Completed),
    );
    expect(await stateOf(first.id)).toBe(JobState.Completed);
  });

  it('does not mark a job failed when saving its output fails', async () => {
    runner.register('noop', async () => null);
    const complete = vi
      .spyOn(queue, 'complete')
      .mockRejectedValueOnce(new Error('disk full'));
    const job = await queue.create({ name: 'noop', input: {} });

    await runner.start();

    await vi.waitFor(() => expect(complete).toHaveBeenCalled());
    expect(await stateOf(job.id)).toBe(JobState.Processing);
  });

  it('rejects a second handler for the same name', () => {
    runner.register('noop', async () => null);
    expect(() => runner.register('noop', async () => null)).toThrow();
  });
});

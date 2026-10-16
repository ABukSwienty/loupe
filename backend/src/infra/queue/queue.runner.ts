import { setTimeout as sleep } from 'node:timers/promises';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { JOB_QUEUE, type JobQueue } from './interface.js';
import { JobState, type Job } from './job.model.js';

export type JobHandler<Input = any, Output = any> = (
  input: Input,
  ctx: {
    job: Job<string, Input, Output>;
    /** Aborted on shutdown. Pass it to fetch and other long calls. */
    signal: AbortSignal;
  },
) => Promise<Output>;

/**
 * Runs jobs one at a time until the queue is drained, then sleeps until a job
 * is created. Domain modules register a handler per job name in onModuleInit;
 * the first drain runs on application bootstrap, after every module has
 * initialised, and only names with a handler are claimed.
 *
 * Wake-ups come from QueueService.create in this process. Jobs inserted by
 * another process are only picked up on the next wake-up or restart.
 */
@Injectable()
export class QueueRunner
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(QueueRunner.name);
  private readonly handlers = new Map<string, JobHandler>();
  private controller: AbortController | null = null;
  private unsubscribe: (() => void) | null = null;
  private draining: Promise<void> | null = null;
  /** Set when a wake-up arrives mid-drain, so the drain checks once more. */
  private requested = false;

  /** Waits between retries when claiming fails, e.g. on a locked database. */
  claimRetryDelaysMs = [2_000, 5_000, 10_000];

  constructor(@Inject(JOB_QUEUE) private readonly queue: JobQueue) {}

  register<Input, Output>(name: string, handler: JobHandler<Input, Output>) {
    if (this.handlers.has(name)) {
      throw new Error(`A handler for job "${name}" is already registered`);
    }
    this.handlers.set(name, handler);
  }

  async onApplicationBootstrap() {
    await this.start();
  }

  async onApplicationShutdown() {
    await this.stop();
  }

  async start() {
    if (this.controller) return;

    // This runner is the only consumer, so anything still processing was cut
    // off by a crash or restart. Revisit if other workers start claiming jobs.
    const { requeued, failed } = await this.queue.requeueStale();
    if (requeued > 0) this.logger.warn(`Requeued ${requeued} stale job(s)`);
    if (failed > 0) {
      this.logger.warn(`Failed ${failed} stale job(s) with no attempts left`);
    }

    this.controller = new AbortController();
    this.unsubscribe = this.queue.onCreated(() => this.wake());
    this.wake();
  }

  /** Stops claiming, aborts the running job's signal and waits for it to settle. */
  async stop() {
    this.unsubscribe?.();
    this.controller?.abort();
    await this.draining;
    this.unsubscribe = null;
    this.controller = null;
  }

  /** Starts a drain, or asks the running one to check again before it exits. */
  private wake() {
    const signal = this.controller?.signal;
    if (!signal || signal.aborted) return;

    this.requested = true;
    this.draining ??= this.drain(signal);
  }

  private async drain(signal: AbortSignal) {
    try {
      while (!signal.aborted) {
        this.requested = false;

        let job: Job | null;
        try {
          job = await this.claim(signal);
        } catch (err) {
          this.logger.error(
            'Failed to claim a job; waiting for the next wake-up',
            err,
          );
          return;
        }

        if (job) {
          await this.process(job, signal);
        } else if (!this.requested) {
          return;
        }
      }
    } finally {
      // Cleared in the same tick as the exit check, so a wake() after this
      // point starts a new drain rather than being lost.
      this.draining = null;
    }
  }

  /** Claims the next job, retrying after each delay in claimRetryDelaysMs before giving up. */
  private async claim(signal: AbortSignal): Promise<Job | null> {
    const names = [...this.handlers.keys()];
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.queue.claim(names);
      } catch (err) {
        const delay = this.claimRetryDelaysMs[attempt];
        if (delay === undefined) throw err;

        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Failed to claim a job (${message}); retrying in ${delay}ms`,
        );
        await sleep(delay, undefined, { signal }).catch(() => {});
        if (signal.aborted) return null;
      }
    }
  }

  private async process(job: Job, signal: AbortSignal) {
    const handler = this.handlers.get(job.name)!;
    const startedAt = Date.now();
    this.logger.log(`Job ${job.id} (${job.name}) started`);

    let output: unknown;
    try {
      output = await handler(job.input, { job, signal });
    } catch (err) {
      if (signal.aborted) {
        // Left as processing; start() requeues it on the next boot.
        this.logger.warn(`Job ${job.id} (${job.name}) interrupted by shutdown`);
        return;
      }

      // A requeued job goes to the back of the queue; this drain reaches it again.
      const message = err instanceof Error ? err.message : String(err);
      const attempt = `attempt ${job.attempts}/${job.maxAttempts}`;
      try {
        const updated = await this.queue.fail(job.id, message);
        const outcome =
          updated?.state === JobState.Queued ? 'retrying' : 'giving up';
        this.logger.error(
          `Job ${job.id} (${job.name}) failed on ${attempt}, ${outcome}: ${message}`,
        );
      } catch (e) {
        this.logger.error(
          `Job ${job.id} (${job.name}) failed on ${attempt}: ${message}; could not record the failure`,
          e,
        );
      }
      return;
    }

    try {
      await this.queue.complete(job.id, output ?? null);
      this.logger.log(
        `Job ${job.id} (${job.name}) completed in ${Date.now() - startedAt}ms`,
      );
    } catch (err) {
      // Left as processing; start() requeues it on the next boot.
      this.logger.error(
        `Job ${job.id} (${job.name}) finished but its output could not be saved`,
        err,
      );
    }
  }
}

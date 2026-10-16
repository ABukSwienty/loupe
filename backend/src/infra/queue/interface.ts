import type { Job, JobState } from './job.model.js';

export const JOB_QUEUE = Symbol('JOB_QUEUE');

export interface JobQueue {
  findOne(id: string): Promise<Job | null>;
  findMany(where: { name?: string; state?: JobState }): Promise<Job[]>;
  /**
   * A page of jobs. `order: 'queue'` is the order queued jobs will run in;
   * `'newest'` is by creation, newest first. `videoId` matches `input.videoId`.
   */
  list(
    where: { name?: string; state?: JobState; videoId?: string },
    page: { offset: number; limit: number; order: 'queue' | 'newest' },
  ): Promise<{ items: Job[]; total: number }>;
  /** Number of jobs in each state. */
  countByState(): Promise<Record<JobState, number>>;
  /** maxAttempts defaults to 3. */
  create(data: {
    name: string;
    input: any;
    maxAttempts?: number;
  }): Promise<Job>;
  /** Calls listener after every create in this process. Returns an unsubscribe function. */
  onCreated(listener: (job: Job) => void): () => void;

  /**
   * Atomically moves the oldest queued job to processing and counts the
   * attempt, optionally only among the given names.
   */
  claim(names?: string[]): Promise<Job | null>;
  /** Marks a processing job completed. Returns null if it was not processing. */
  complete(id: string, output: any): Promise<Job | null>;
  /**
   * Records the error on a processing job and requeues it if it has attempts
   * left, otherwise marks it failed. Returns null if it was not processing.
   */
  fail(id: string, error: string): Promise<Job | null>;
  /**
   * Handles jobs left processing by a crash: requeues those with attempts
   * left and fails the rest.
   */
  requeueStale(): Promise<{ requeued: number; failed: number }>;
}

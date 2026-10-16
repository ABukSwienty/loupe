import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Store } from '../store/client.js';
import { jobs } from '../store/schema/index.js';
import { STORE } from '../store/store.module.js';
import type { JobQueue } from './interface.js';
import { JobState, toJob, type Job } from './job.model.js';

// Evaluated inside each insert/update, so the read and the write are one statement.
const nextQueuePosition = sql`(select coalesce(max(${jobs.queuePosition}), 0) + 1 from ${jobs})`;

// better-sqlite3 is synchronous; the methods are async to match the interface,
// so a different backend can be swapped in later.
@Injectable()
export class QueueService implements JobQueue {
  private readonly createdListeners = new Set<(job: Job) => void>();

  constructor(@Inject(STORE) private readonly store: Store) {}

  onCreated(listener: (job: Job) => void): () => void {
    this.createdListeners.add(listener);
    return () => this.createdListeners.delete(listener);
  }

  async findOne(id: string): Promise<Job | null> {
    const row = this.store.select().from(jobs).where(eq(jobs.id, id)).get();
    return row ? toJob(row) : null;
  }

  async findMany(where: { name?: string; state?: JobState }): Promise<Job[]> {
    const rows = this.store
      .select()
      .from(jobs)
      .where(
        and(
          where.name !== undefined ? eq(jobs.name, where.name) : undefined,
          where.state !== undefined ? eq(jobs.state, where.state) : undefined,
        ),
      )
      .orderBy(asc(jobs.createdAt), asc(sql`rowid`))
      .all();
    return rows.map(toJob);
  }

  async list(
    where: { name?: string; state?: JobState; videoId?: string },
    page: { offset: number; limit: number; order: 'queue' | 'newest' },
  ): Promise<{ items: Job[]; total: number }> {
    const filter = and(
      where.name !== undefined ? eq(jobs.name, where.name) : undefined,
      where.state !== undefined ? eq(jobs.state, where.state) : undefined,
      where.videoId !== undefined
        ? sql`json_extract(${jobs.input}, '$.videoId') = ${where.videoId}`
        : undefined,
    );
    const rows = this.store
      .select()
      .from(jobs)
      .where(filter)
      .orderBy(
        ...(page.order === 'queue'
          ? [asc(jobs.queuePosition)]
          : [desc(jobs.createdAt), desc(sql`rowid`)]),
      )
      .limit(page.limit)
      .offset(page.offset)
      .all();
    const { total } = this.store
      .select({ total: count() })
      .from(jobs)
      .where(filter)
      .get()!;
    return { items: rows.map(toJob), total };
  }

  async countByState(): Promise<Record<JobState, number>> {
    const counts = Object.fromEntries(
      Object.values(JobState).map((s) => [s, 0]),
    ) as Record<JobState, number>;
    const rows = this.store
      .select({ state: jobs.state, n: count() })
      .from(jobs)
      .groupBy(jobs.state)
      .all();
    for (const { state, n } of rows) counts[state] = n;
    return counts;
  }

  async create(data: {
    name: string;
    input: any;
    maxAttempts?: number;
  }): Promise<Job> {
    const now = Date.now();
    const row = this.store
      .insert(jobs)
      .values({
        id: randomUUID(),
        name: data.name,
        state: JobState.Queued,
        input: data.input,
        maxAttempts: data.maxAttempts,
        createdAt: now,
        queuePosition: nextQueuePosition,
      })
      .returning()
      .get();
    const job = toJob(row);
    for (const listener of this.createdListeners) listener(job);
    return job;
  }

  async claim(names?: string[]): Promise<Job | null> {
    if (names?.length === 0) return null;

    // One statement, so two claimers can never get the same job.
    const next = this.store
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.state, JobState.Queued),
          names !== undefined ? inArray(jobs.name, names) : undefined,
        ),
      )
      .orderBy(asc(jobs.queuePosition))
      .limit(1);

    const row = this.store
      .update(jobs)
      .set({
        state: JobState.Processing,
        processedAt: Date.now(),
        attempts: sql`${jobs.attempts} + 1`,
      })
      .where(inArray(jobs.id, next))
      .returning()
      .get();
    return row ? toJob(row) : null;
  }

  async complete(id: string, output: any): Promise<Job | null> {
    const row = this.store
      .update(jobs)
      .set({
        state: JobState.Completed,
        output,
        error: null,
        completedAt: Date.now(),
      })
      .where(and(eq(jobs.id, id), eq(jobs.state, JobState.Processing)))
      .returning()
      .get();
    return row ? toJob(row) : null;
  }

  async fail(id: string, error: string): Promise<Job | null> {
    // Decided in SQL so the check and the write can't drift apart. A retry
    // goes to the back of the queue rather than being claimed again at once.
    const retry = sql`${jobs.attempts} < ${jobs.maxAttempts}`;
    const now = Date.now();
    const row = this.store
      .update(jobs)
      .set({
        state: sql`case when ${retry} then ${JobState.Queued} else ${JobState.Failed} end`,
        error,
        queuePosition: sql`case when ${retry} then ${nextQueuePosition} else ${jobs.queuePosition} end`,
        completedAt: sql`case when ${retry} then null else ${now} end`,
      })
      .where(and(eq(jobs.id, id), eq(jobs.state, JobState.Processing)))
      .returning()
      .get();
    return row ? toJob(row) : null;
  }

  async requeueStale(): Promise<{ requeued: number; failed: number }> {
    const exhausted = sql`${jobs.attempts} >= ${jobs.maxAttempts}`;
    return this.store.transaction((tx) => {
      const failed = tx
        .update(jobs)
        .set({
          state: JobState.Failed,
          error: 'Interrupted on its last attempt',
          completedAt: Date.now(),
        })
        .where(and(eq(jobs.state, JobState.Processing), exhausted))
        .run().changes;

      const requeued = tx
        .update(jobs)
        .set({ state: JobState.Queued, processedAt: null })
        .where(eq(jobs.state, JobState.Processing))
        .run().changes;

      return { requeued, failed };
    });
  }
}

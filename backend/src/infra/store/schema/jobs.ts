import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { JobState } from '../../queue/job.model.js';

// Timestamps are unix milliseconds. Enums are stored as text so the file stays
// readable from the sqlite3 CLI and from the Python workers.

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    state: text('state').$type<JobState>().notNull().default(JobState.Queued),
    input: text('input', { mode: 'json' }).notNull(),
    output: text('output', { mode: 'json' }),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    createdAt: integer('created_at').notNull(),
    /**
     * Strictly increasing order in which jobs entered the queue; claims take
     * the lowest. A retry gets a new one, so it goes to the back.
     */
    queuePosition: integer('queue_position').notNull(),
    processedAt: integer('processed_at'),
    completedAt: integer('completed_at'),
  },
  (t) => [
    index('jobs_state_queue_position_idx').on(t.state, t.queuePosition),
    index('jobs_queue_position_idx').on(t.queuePosition),
  ],
);

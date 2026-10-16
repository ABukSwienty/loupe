import type { jobs } from '../store/schema/index.js';

export enum JobState {
  Queued = 'queued',
  Processing = 'processing',
  Failed = 'failed',
  Completed = 'completed',
}

export type Job<Name extends string = string, Input = any, Output = any> = {
  id: string;
  createdAt: number;
  processedAt: number | null;
  completedAt: number | null;
  name: Name;
  state: JobState;
  input: Input;
  output: Output | null; // null until the job completes
  error: string | null; // last failure; kept while a retry is queued
  attempts: number; // times claimed
  maxAttempts: number;
};

export type JobRow = typeof jobs.$inferSelect;

export function toJob(row: JobRow): Job {
  return {
    id: row.id,
    createdAt: row.createdAt,
    processedAt: row.processedAt,
    completedAt: row.completedAt,
    name: row.name,
    state: row.state,
    input: row.input,
    output: row.output ?? null,
    error: row.error,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
  };
}

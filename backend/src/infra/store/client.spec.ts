import { eq, sql } from 'drizzle-orm';
import { openStore, type Store } from './client.js';
import { jobs } from './schema/index.js';

describe('openStore', () => {
  let store: Store;

  beforeEach(() => {
    store = openStore(':memory:');
  });

  afterEach(() => {
    store.$client.close();
  });

  it('loads sqlite-vec', () => {
    const row = store.get<{ version: string }>(
      sql`select vec_version() as version`,
    );
    expect(row.version).toMatch(/^v\d/);
  });

  it('applies migrations and round-trips json columns', () => {
    store
      .insert(jobs)
      .values({
        id: 'job-1',
        name: 'transcribe',
        input: { path: '/videos/a.mp4' },
        createdAt: Date.now(),
        queuePosition: 1,
      })
      .run();

    const job = store.select().from(jobs).where(eq(jobs.id, 'job-1')).get();
    expect(job?.state).toBe('queued');
    expect(job?.input).toEqual({ path: '/videos/a.mp4' });
  });
});

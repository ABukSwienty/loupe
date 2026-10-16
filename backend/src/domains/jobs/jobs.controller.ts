import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import {
  parsePageQuery,
  toOffset,
  type Page,
} from '../../common/pagination.js';
import { JOB_QUEUE, type JobQueue } from '../../infra/queue/interface.js';
import { JobState, type Job } from '../../infra/queue/job.model.js';

/** How many queued jobs the summary lists. */
const SUMMARY_NEXT = 10;

@Controller('jobs')
export class JobsController {
  constructor(@Inject(JOB_QUEUE) private readonly queue: JobQueue) {}

  /**
   * `?state=&name=&videoId=&page=&pageSize=`, all optional. Queued jobs are
   * listed in the order they will run; anything else newest first.
   */
  @Get()
  async findMany(@Query() query: Record<string, unknown>): Promise<Page<Job>> {
    const state = optionalString(query, 'state');
    if (state !== undefined && !isJobState(state)) {
      throw new BadRequestException(
        `state must be one of ${Object.values(JobState).join(', ')}`,
      );
    }
    const request = parsePageQuery(query);
    const { items, total } = await this.queue.list(
      {
        state,
        name: optionalString(query, 'name'),
        videoId: optionalString(query, 'videoId'),
      },
      {
        ...toOffset(request),
        order: state === JobState.Queued ? 'queue' : 'newest',
      },
    );
    return { items, total, ...request };
  }

  /** Counts per state, the job running now, and the next ones in line. */
  @Get('summary')
  async summary(): Promise<{
    counts: Record<JobState, number>;
    running: Job[];
    next: Job[];
  }> {
    const [counts, running, next] = await Promise.all([
      this.queue.countByState(),
      this.queue.list(
        { state: JobState.Processing },
        { offset: 0, limit: SUMMARY_NEXT, order: 'newest' },
      ),
      this.queue.list(
        { state: JobState.Queued },
        { offset: 0, limit: SUMMARY_NEXT, order: 'queue' },
      ),
    ]);
    return { counts, running: running.items, next: next.items };
  }

  /** State, attempts, output or error of any job, e.g. one returned by an analysis endpoint. */
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Job> {
    const job = await this.queue.findOne(id);
    if (!job) throw new NotFoundException();
    return job;
  }
}

function isJobState(value: string): value is JobState {
  return (Object.values(JobState) as string[]).includes(value);
}

function optionalString(
  query: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = query[key];
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new BadRequestException(`${key} must be given once`);
  }
  return value;
}

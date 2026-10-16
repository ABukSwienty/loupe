import {
  BadGatewayException,
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { WorkerError } from '../../infra/worker-client/worker-client.service.js';
import type {
  SceneHit,
  SearchResponse,
  TranscriptHit,
} from './search.model.js';
import {
  SearchScopeNotFoundError,
  SearchService,
  type SearchScope,
} from './search.service.js';

const MAX_K = 50;

/**
 * `?q=<text>&k=<hits, default 10, max 50>&groupId=&videoId=`. Hits are
 * ordered closest first; seek the player to `chunk.start` or `scene.start`
 * (seconds). Without groupId or videoId, searches all videos. An unknown
 * group or video is 404.
 */
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** What is said: transcript chunks closest in meaning to `q`. */
  @Get('transcripts')
  transcripts(
    @Query() query: Record<string, unknown>,
  ): Promise<SearchResponse<TranscriptHit>> {
    const { q, k, scope } = parseSearchQuery(query);
    return withWorker(() => this.search.transcripts(q, k, scope));
  }

  /** What is shown: scene keyframes that best match the description `q`. */
  @Get('scenes')
  scenes(
    @Query() query: Record<string, unknown>,
  ): Promise<SearchResponse<SceneHit>> {
    const { q, k, scope } = parseSearchQuery(query);
    return withWorker(() => this.search.scenes(q, k, scope));
  }
}

function parseSearchQuery(query: Record<string, unknown>) {
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q === '') throw new BadRequestException('q must be a non-empty string');

  let k = 10;
  if (query.k !== undefined && query.k !== '') {
    k = typeof query.k === 'string' ? Number(query.k) : NaN;
    if (!Number.isInteger(k) || k < 1 || k > MAX_K) {
      throw new BadRequestException(`k must be an integer from 1 to ${MAX_K}`);
    }
  }
  const scope: SearchScope = {};
  for (const key of ['groupId', 'videoId'] as const) {
    const value = query[key];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string') {
      throw new BadRequestException(`${key} must be given once`);
    }
    scope[key] = value;
  }
  return { q, k, scope };
}

/** The query has to be embedded by the worker; report its failures as 502. */
async function withWorker<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof SearchScopeNotFoundError) {
      throw new NotFoundException(err.message);
    }
    if (err instanceof WorkerError) {
      throw new BadGatewayException(err.message);
    }
    // fetch rejects with a TypeError when the worker can't be reached.
    if (err instanceof TypeError && err.message === 'fetch failed') {
      throw new BadGatewayException('The worker is not reachable');
    }
    throw err;
  }
}

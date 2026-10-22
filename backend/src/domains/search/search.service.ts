import { Inject, Injectable } from '@nestjs/common';
import { and, asc, between, eq, inArray } from 'drizzle-orm';
import type { Store } from '../../infra/store/client.js';
import {
  sceneDetections,
  scenes,
  transcriptionChunks,
  transcriptions,
  transcriptionSegments,
  videos,
} from '../../infra/store/schema/index.js';
import { STORE } from '../../infra/store/store.module.js';
import {
  searchChunkEmbeddings,
  searchSceneEmbeddings,
} from '../../infra/store/vectors.js';
import {
  WORKER_CLIENT,
  type WorkerClient,
} from '../../infra/worker-client/interface.js';
import { toScene } from '../scene-detection/scene.model.js';
import { GroupsService } from '../groups/groups.service.js';
import { VideosService } from '../videos/videos.service.js';
import type {
  SceneHit,
  SearchResponse,
  TranscriptHit,
} from './search.model.js';

/** Limits a search. Both together mean the video, if it is in the group. */
export type SearchScope = { groupId?: string; videoId?: string };

/** The scope names a group or video that doesn't exist. */
export class SearchScopeNotFoundError extends Error {}

/**
 * Semantic search over the stored vectors. The query is embedded by the
 * worker with the same model family as the stored vectors, and only vectors
 * from that exact model are compared.
 */
@Injectable()
export class SearchService {
  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(WORKER_CLIENT) private readonly worker: WorkerClient,
    private readonly groups: GroupsService,
    private readonly videos: VideosService,
  ) {}

  /** The videos a scope covers, or undefined for all videos. */
  private async videoIds(scope: SearchScope): Promise<string[] | undefined> {
    let ids: string[] | undefined;
    if (scope.groupId !== undefined) {
      const group = await this.groups.findOne(scope.groupId);
      if (!group) {
        throw new SearchScopeNotFoundError(`Group ${scope.groupId} not found`);
      }
      ids = group.videoIds;
    }
    if (scope.videoId !== undefined) {
      if (!(await this.videos.findOne(scope.videoId))) {
        throw new SearchScopeNotFoundError(`Video ${scope.videoId} not found`);
      }
      ids = !ids || ids.includes(scope.videoId) ? [scope.videoId] : [];
    }
    return ids;
  }

  /** Transcript chunks closest in meaning to the query (bge-m3). */
  async transcripts(
    query: string,
    k: number,
    scope: SearchScope = {},
    signal?: AbortSignal,
  ): Promise<SearchResponse<TranscriptHit>> {
    // Checked first, so an unknown scope fails without a worker call.
    const videoIds = await this.videoIds(scope);
    const res = await this.worker.embedDocuments([query], { signal });
    const neighbours = searchChunkEmbeddings(this.store, res.vectors[0], {
      k,
      model: res.model,
      videoIds,
    });
    if (neighbours.length === 0) return { query, model: res.model, hits: [] };

    const chunks = this.store
      .select({
        chunk: transcriptionChunks,
        video: { id: videos.id, title: videos.title, channel: videos.channel },
      })
      .from(transcriptionChunks)
      .innerJoin(
        transcriptions,
        eq(transcriptionChunks.transcriptionId, transcriptions.id),
      )
      .innerJoin(videos, eq(transcriptions.videoId, videos.id))
      .where(
        inArray(
          transcriptionChunks.id,
          neighbours.map((n) => n.id),
        ),
      )
      .all();
    const byId = new Map(chunks.map((row) => [row.chunk.id, row]));

    const hits: TranscriptHit[] = [];
    for (const { id, distance } of neighbours) {
      const row = byId.get(id);
      if (!row) continue; // vector without a chunk; shouldn't happen with the triggers
      const { chunk, video } = row;
      const segments = this.store
        .select({
          index: transcriptionSegments.index,
          start: transcriptionSegments.start,
          end: transcriptionSegments.end,
          text: transcriptionSegments.text,
          avgLogprob: transcriptionSegments.avgLogprob,
          noSpeechProb: transcriptionSegments.noSpeechProb,
        })
        .from(transcriptionSegments)
        .where(
          and(
            eq(transcriptionSegments.transcriptionId, chunk.transcriptionId),
            between(
              transcriptionSegments.index,
              chunk.startSegment,
              chunk.endSegment,
            ),
          ),
        )
        .orderBy(asc(transcriptionSegments.index))
        .all();
      hits.push({
        distance,
        video,
        chunk: {
          id: chunk.id,
          index: chunk.index,
          start: chunk.start,
          end: chunk.end,
          text: chunk.text,
        },
        segments,
      });
    }
    return { query, model: res.model, hits };
  }

  /** Scene keyframes that best match a text description (SigLIP). */
  async scenes(
    query: string,
    k: number,
    scope: SearchScope = {},
    signal?: AbortSignal,
  ): Promise<SearchResponse<SceneHit>> {
    // Checked first, so an unknown scope fails without a worker call.
    const videoIds = await this.videoIds(scope);
    const res = await this.worker.embedImageQueries([query], { signal });
    const neighbours = searchSceneEmbeddings(this.store, res.vectors[0], {
      k,
      model: res.model,
      videoIds,
    });
    if (neighbours.length === 0) return { query, model: res.model, hits: [] };

    const rows = this.store
      .select({
        scene: scenes,
        video: { id: videos.id, title: videos.title, channel: videos.channel },
      })
      .from(scenes)
      .innerJoin(
        sceneDetections,
        eq(scenes.sceneDetectionId, sceneDetections.id),
      )
      .innerJoin(videos, eq(sceneDetections.videoId, videos.id))
      .where(
        inArray(
          scenes.id,
          neighbours.map((n) => n.id),
        ),
      )
      .all();
    const byId = new Map(rows.map((row) => [row.scene.id, row]));

    const hits: SceneHit[] = [];
    for (const { id, distance } of neighbours) {
      const row = byId.get(id);
      if (!row) continue;
      hits.push({
        distance,
        video: row.video,
        scene: toScene(row.video.id, row.scene),
      });
    }
    return { query, model: res.model, hits };
  }
}

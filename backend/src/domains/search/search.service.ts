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
  SceneMatch,
  SceneMatchResponse,
  SearchResponse,
  TranscriptHit,
} from './search.model.js';

/** Limits a search. Both together mean the video, if it is in the group. */
export type SearchScope = { groupId?: string; videoId?: string };

/** The scope names a group or video that doesn't exist. */
export class SearchScopeNotFoundError extends Error {}

/** The video has no scenes to match against. */
export class ScenesNotDetectedError extends Error {}

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

  /**
   * Every scene of one video whose keyframe is within `maxDistance` (cosine)
   * of a text description, and how much of the video they make up. With
   * `invert`, the embedded scenes further away than that instead; scenes
   * without a vector are in neither.
   */
  async sceneMatches(
    videoId: string,
    query: string,
    maxDistance: number,
    invert = false,
    signal?: AbortSignal,
  ): Promise<SceneMatchResponse> {
    const video = this.store
      .select({ id: videos.id, title: videos.title, channel: videos.channel })
      .from(videos)
      .where(eq(videos.id, videoId))
      .get();
    if (!video)
      throw new SearchScopeNotFoundError(`Video ${videoId} not found`);

    const rows = this.store
      .select({ scene: scenes })
      .from(scenes)
      .innerJoin(
        sceneDetections,
        eq(scenes.sceneDetectionId, sceneDetections.id),
      )
      .where(eq(sceneDetections.videoId, videoId))
      .all()
      .map((row) => row.scene);
    if (rows.length === 0) {
      throw new ScenesNotDetectedError('Scene detection has not run');
    }
    const byId = new Map(rows.map((scene) => [scene.id, scene]));

    const res = await this.worker.embedImageQueries([query], { signal });
    // Distances for all of the video's scenes; thresholding happens here.
    const neighbours = searchSceneEmbeddings(this.store, res.vectors[0], {
      k: rows.length,
      model: res.model,
      videoIds: [videoId],
    });

    const matches: SceneMatch[] = [];
    for (const { id, distance } of neighbours) {
      const scene = byId.get(id);
      if (!scene || distance > maxDistance !== invert) continue;
      matches.push({ distance, scene: toScene(videoId, scene) });
    }
    // Neighbours are closest first; the inverse reads best furthest first.
    if (invert) matches.reverse();

    const length = (s: { start: number; end: number }) => s.end - s.start;
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    return {
      query,
      model: res.model,
      maxDistance,
      invert,
      video,
      scenes: {
        total: rows.length,
        embedded: neighbours.length,
        matched: matches.length,
      },
      duration: {
        total: sum(rows.map(length)),
        matched: sum(matches.map((m) => length(m.scene))),
      },
      matches,
    };
  }
}

import type { videos } from '../../infra/store/schema/index.js';
import type { Scene } from '../scene-detection/scene.model.js';
import type { TranscriptionSegment } from '../transcription/transcription.model.js';

export type SearchVideo = Pick<
  typeof videos.$inferSelect,
  'id' | 'title' | 'channel'
>;

/** Cosine distance: 0 is the same direction, 2 the opposite. Lower is closer. */
export type Distance = number;

export type TranscriptHit = {
  distance: Distance;
  video: SearchVideo;
  /** The ~30-second chunk that matched. Seek to `start`. */
  chunk: {
    id: number;
    index: number;
    start: number;
    end: number;
    text: string;
  };
  /** The segments inside the chunk, without word timings. */
  segments: Omit<TranscriptionSegment, 'words'>[];
};

export type SceneHit = {
  distance: Distance;
  video: SearchVideo;
  scene: Scene;
};

export type SceneMatch = {
  distance: Distance;
  scene: Scene;
};

/**
 * The scenes of one video within `maxDistance` of a description, or with
 * `invert`, the embedded scenes further away than that.
 */
export type SceneMatchResponse = {
  query: string;
  model: string;
  maxDistance: Distance;
  invert: boolean;
  video: SearchVideo;
  scenes: {
    /** Every detected scene. */
    total: number;
    /** Scenes with a keyframe vector; the others can't match. */
    embedded: number;
    /** The scenes returned in `matches`. */
    matched: number;
  };
  /** Seconds covered by all scenes and by the matched ones. */
  duration: { total: number; matched: number };
  /** Closest first, or furthest first with `invert`. */
  matches: SceneMatch[];
};

export type SearchResponse<Hit> = {
  query: string;
  model: string;
  hits: Hit[];
};

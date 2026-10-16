import type { videos } from '../../infra/store/schema/index.js';
import type {
  Scene,
  TranscriptionSegment,
} from '../analysis/analysis.model.js';

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

export type SearchResponse<Hit> = {
  query: string;
  model: string;
  hits: Hit[];
};

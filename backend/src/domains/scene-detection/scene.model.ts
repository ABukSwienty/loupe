import { ROUTES } from '../../common/routes.js';
import type {
  sceneDetections,
  scenes,
} from '../../infra/store/schema/index.js';

/** The keyframe is exposed as an API path, not the file path on the server. */
export type Scene = Omit<
  typeof scenes.$inferSelect,
  'sceneDetectionId' | 'keyframePath'
> & {
  /** GET this (relative to the API base) for the JPEG; null without a keyframe. */
  keyframeUrl: string | null;
};

export type SceneDetection = typeof sceneDetections.$inferSelect & {
  scenes: Scene[];
};

export type SceneDetectionSummary = {
  id: string;
  createdAt: number;
  scenes: number;
  keyframes: number;
};

export function keyframeUrl(videoId: string, sceneId: string) {
  const path = ROUTES.scenes.keyframe
    .replace(':videoId', videoId)
    .replace(':sceneId', sceneId);
  return `/${ROUTES.scenes.base}/${path}`;
}

export function toScene(
  videoId: string,
  row: typeof scenes.$inferSelect,
): Scene {
  const { sceneDetectionId: _, keyframePath, ...rest } = row;
  return {
    ...rest,
    keyframeUrl: keyframePath ? keyframeUrl(videoId, row.id) : null,
  };
}

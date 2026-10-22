import type { SceneDetection, SceneDetectionSummary } from './scene.model.js';

export const SCENE_DETECTOR = Symbol('SCENE_DETECTOR');

export type SceneDetectionInput = {
  videoId: string;
  detector: 'adaptive' | 'content';
  threshold: number | null;
  keyframeWidth: number;
};

export type KeyframeScene = {
  id: string;
  keyframePath: string;
  keyframeTime: number | null;
};

export interface SceneDetector {
  /**
   * Job handler: detects scenes, writes one keyframe JPEG per scene to disk
   * and replaces the previous detection. Replacing removes the old scenes' OCR
   * results and embeddings too, so those steps have to run again.
   */
  detect(
    input: SceneDetectionInput,
    signal?: AbortSignal,
  ): Promise<{ sceneDetectionId: string; scenes: number } | null>;

  /** Scenes of the video's detection that have a keyframe on disk, in order. */
  keyframeScenes(videoId: string): KeyframeScene[];

  /** The video's detection with ordered scenes, or null if it hasn't run. */
  scenes(videoId: string): SceneDetection | null;

  /** The keyframe file of one of the video's scenes, or null. */
  keyframePath(videoId: string, sceneId: string): string | null;

  summary(videoId: string): SceneDetectionSummary | null;
}

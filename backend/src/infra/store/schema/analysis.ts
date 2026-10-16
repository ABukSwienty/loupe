import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import { videos } from './videos.js';

// Results of the worker endpoints, stored as the worker returns them: times
// are in seconds. Each run gets a parent row tied to its video; re-running a
// step adds a new parent, and deleting a video or parent removes its rows.

const videoId = () =>
  text('video_id')
    .notNull()
    .references(() => videos.id, { onDelete: 'cascade' });

// ---------- transcribe ----------

export const transcriptions = sqliteTable(
  'transcriptions',
  {
    id: text('id').primaryKey(),
    videoId: videoId(),
    language: text('language').notNull(), // ISO code, e.g. "de"
    languageProbability: real('language_probability').notNull(),
    duration: real('duration').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('transcriptions_video_id_idx').on(t.videoId)],
);

export type TranscriptWord = {
  start: number;
  end: number;
  word: string;
  probability: number;
};

export const transcriptionSegments = sqliteTable(
  'transcription_segments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    transcriptionId: text('transcription_id')
      .notNull()
      .references(() => transcriptions.id, { onDelete: 'cascade' }),
    index: integer('index').notNull(), // order within the transcription
    start: real('start').notNull(),
    end: real('end').notNull(),
    text: text('text').notNull(),
    avgLogprob: real('avg_logprob').notNull(),
    noSpeechProb: real('no_speech_prob').notNull(),
    words: text('words', { mode: 'json' }).$type<TranscriptWord[]>().notNull(),
  },
  (t) => [
    index('transcription_segments_transcription_id_idx').on(
      t.transcriptionId,
      t.index,
    ),
  ],
);

/**
 * A run of consecutive segments, about 30 seconds long, embedded as one text.
 * Vectors are in chunk_embeddings (see vectors.ts), keyed by this id.
 */
export const transcriptionChunks = sqliteTable(
  'transcription_chunks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    transcriptionId: text('transcription_id')
      .notNull()
      .references(() => transcriptions.id, { onDelete: 'cascade' }),
    index: integer('index').notNull(), // order within the transcription
    /** First and last transcription_segments.index covered, inclusive. */
    startSegment: integer('start_segment').notNull(),
    endSegment: integer('end_segment').notNull(),
    start: real('start').notNull(),
    end: real('end').notNull(),
    text: text('text').notNull(),
  },
  (t) => [
    index('transcription_chunks_transcription_id_idx').on(
      t.transcriptionId,
      t.index,
    ),
  ],
);

// ---------- diarize ----------

export const diarizations = sqliteTable(
  'diarizations',
  {
    id: text('id').primaryKey(),
    videoId: videoId(),
    speakers: text('speakers', { mode: 'json' }).$type<string[]>().notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('diarizations_video_id_idx').on(t.videoId)],
);

export const diarizationSegments = sqliteTable(
  'diarization_segments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    diarizationId: text('diarization_id')
      .notNull()
      .references(() => diarizations.id, { onDelete: 'cascade' }),
    start: real('start').notNull(),
    end: real('end').notNull(),
    speaker: text('speaker').notNull(), // "SPEAKER_00", local to the video
    /** True for the one-speaker-at-a-time segments, false for the overlapping ones. */
    exclusive: integer('exclusive', { mode: 'boolean' }).notNull(),
  },
  (t) => [
    index('diarization_segments_diarization_id_idx').on(
      t.diarizationId,
      t.exclusive,
      t.start,
    ),
  ],
);

// ---------- scenes ----------

export const sceneDetections = sqliteTable(
  'scene_detections',
  {
    id: text('id').primaryKey(),
    videoId: videoId(),
    detector: text('detector').$type<'adaptive' | 'content'>().notNull(),
    threshold: real('threshold'), // null = detector default
    fps: real('fps').notNull(),
    duration: real('duration').notNull(),
    sceneCount: integer('scene_count').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('scene_detections_video_id_idx').on(t.videoId)],
);

/** Keyframe vectors are in scene_embeddings (see vectors.ts), keyed by this id. */
export const scenes = sqliteTable(
  'scenes',
  {
    id: text('id').primaryKey(),
    sceneDetectionId: text('scene_detection_id')
      .notNull()
      .references(() => sceneDetections.id, { onDelete: 'cascade' }),
    index: integer('index').notNull(),
    start: real('start').notNull(),
    end: real('end').notNull(),
    startFrame: integer('start_frame').notNull(),
    endFrame: integer('end_frame').notNull(),
    keyframeTime: real('keyframe_time'),
    /** JPEG on disk; the worker's base64 is not stored. */
    keyframePath: text('keyframe_path'),
  },
  (t) => [
    index('scenes_scene_detection_id_idx').on(t.sceneDetectionId, t.index),
  ],
);

// ---------- ocr ----------

/** One OCR'd image: a scene keyframe, or any frame at a given time. */
export const ocrResults = sqliteTable(
  'ocr_results',
  {
    id: text('id').primaryKey(),
    videoId: videoId(),
    sceneId: text('scene_id').references(() => scenes.id, {
      onDelete: 'cascade',
    }),
    time: real('time'), // seconds into the video the image was taken from
    imagePath: text('image_path'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('ocr_results_video_id_idx').on(t.videoId),
    index('ocr_results_scene_id_idx').on(t.sceneId),
  ],
);

export const ocrLines = sqliteTable(
  'ocr_lines',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ocrResultId: text('ocr_result_id')
      .notNull()
      .references(() => ocrResults.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    score: real('score').notNull(),
    /** Corner points [x, y] in pixels, usually 4. */
    box: text('box', { mode: 'json' }).$type<[number, number][]>().notNull(),
  },
  (t) => [index('ocr_lines_ocr_result_id_idx').on(t.ocrResultId)],
);

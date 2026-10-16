import type { Store } from './client.js';

// Typed access to the sqlite-vec tables from drizzle/0005_embeddings.sql, which
// Drizzle can't model. Vectors are stored as float32 and compared by cosine
// distance (0 = same direction, 2 = opposite).

/** bge-m3. */
export const CHUNK_EMBEDDING_DIM = 1024;
/** SigLIP 2 base. */
export const SCENE_EMBEDDING_DIM = 768;

export type Neighbour<Id> = { id: Id; distance: number };

type SearchOptions = {
  k?: number; // default 10
  /** Only compare against vectors from this model. */
  model?: string;
  /** Only compare against vectors of these videos. */
  videoIds?: string[];
};

function toBlob(vector: number[], dim: number): Buffer {
  if (vector.length !== dim) {
    throw new Error(`Expected a ${dim}-dimension vector, got ${vector.length}`);
  }
  return Buffer.from(new Float32Array(vector).buffer);
}

// vec0 has no upsert, so replacing is delete + insert in one transaction.

export function saveChunkEmbeddings(
  store: Store,
  model: string,
  rows: { chunkId: number; vector: number[] }[],
) {
  const db = store.$client;
  const remove = db.prepare('DELETE FROM chunk_embeddings WHERE chunk_id = ?');
  const insert = db.prepare(
    'INSERT INTO chunk_embeddings (chunk_id, model, embedding) VALUES (?, ?, ?)',
  );
  db.transaction(() => {
    for (const { chunkId, vector } of rows) {
      // vec0 integer keys must be bound as integers, not floats.
      const id = BigInt(chunkId);
      remove.run(id);
      insert.run(id, model, toBlob(vector, CHUNK_EMBEDDING_DIM));
    }
  })();
}

export function saveSceneEmbeddings(
  store: Store,
  model: string,
  rows: { sceneId: string; vector: number[] }[],
) {
  const db = store.$client;
  const remove = db.prepare('DELETE FROM scene_embeddings WHERE scene_id = ?');
  const insert = db.prepare(
    'INSERT INTO scene_embeddings (scene_id, model, embedding) VALUES (?, ?, ?)',
  );
  db.transaction(() => {
    for (const { sceneId, vector } of rows) {
      remove.run(sceneId);
      insert.run(sceneId, model, toBlob(vector, SCENE_EMBEDDING_DIM));
    }
  })();
}

export type EmbeddingCoverage = {
  embedded: number;
  total: number;
  models: string[];
};

/** How many of a transcription's chunks have a vector, and from which models. */
export function chunkEmbeddingCoverage(
  store: Store,
  transcriptionId: string,
): EmbeddingCoverage {
  return coverage(
    store,
    `SELECT count(*) AS total, count(e.chunk_id) AS embedded,
            group_concat(DISTINCT e.model) AS models
     FROM transcription_chunks c
     LEFT JOIN chunk_embeddings e ON e.chunk_id = c.id
     WHERE c.transcription_id = ?`,
    transcriptionId,
  );
}

/** How many of a scene detection's keyframes have a vector, and from which models. */
export function sceneEmbeddingCoverage(
  store: Store,
  sceneDetectionId: string,
): EmbeddingCoverage {
  return coverage(
    store,
    `SELECT count(*) AS total, count(e.scene_id) AS embedded,
            group_concat(DISTINCT e.model) AS models
     FROM scenes s
     LEFT JOIN scene_embeddings e ON e.scene_id = s.id
     WHERE s.scene_detection_id = ? AND s.keyframe_path IS NOT NULL`,
    sceneDetectionId,
  );
}

function coverage(store: Store, query: string, id: string): EmbeddingCoverage {
  const row = store.$client.prepare(query).get(id) as {
    total: number;
    embedded: number;
    models: string | null;
  };
  return {
    embedded: row.embedded,
    total: row.total,
    models: row.models ? row.models.split(',') : [],
  };
}

/**
 * Nearest transcription chunks to a bge-m3 vector, closest first. With
 * `videoIds`, only those videos' chunks are compared (an empty list matches
 * nothing).
 */
export function searchChunkEmbeddings(
  store: Store,
  vector: number[],
  { k = 10, model, videoIds }: SearchOptions = {},
): Neighbour<number>[] {
  const blob = toBlob(vector, CHUNK_EMBEDDING_DIM);
  const rows = (
    videoIds
      ? scopedSearch(
          store,
          `SELECT e.chunk_id AS id, vec_distance_cosine(e.embedding, ?) AS distance
           FROM transcription_chunks c
           JOIN transcriptions t ON t.id = c.transcription_id
           JOIN chunk_embeddings e ON e.chunk_id = c.id
           WHERE t.video_id IN (SELECT value FROM json_each(?))`,
          blob,
          videoIds,
          k,
          model,
        )
      : knnSearch(store, 'chunk_embeddings', 'chunk_id', blob, k, model)
  ) as Neighbour<number | bigint>[];
  return rows.map((r) => ({ id: Number(r.id), distance: r.distance }));
}

/**
 * Nearest scene keyframes to a SigLIP vector (an image or an
 * embedImageQueries text), closest first. With `videoIds`, only those
 * videos' scenes are compared (an empty list matches nothing).
 */
export function searchSceneEmbeddings(
  store: Store,
  vector: number[],
  { k = 10, model, videoIds }: SearchOptions = {},
): Neighbour<string>[] {
  const blob = toBlob(vector, SCENE_EMBEDDING_DIM);
  return (
    videoIds
      ? scopedSearch(
          store,
          `SELECT e.scene_id AS id, vec_distance_cosine(e.embedding, ?) AS distance
           FROM scenes s
           JOIN scene_detections d ON d.id = s.scene_detection_id
           JOIN scene_embeddings e ON e.scene_id = s.id
           WHERE d.video_id IN (SELECT value FROM json_each(?))`,
          blob,
          videoIds,
          k,
          model,
        )
      : knnSearch(store, 'scene_embeddings', 'scene_id', blob, k, model)
  ) as Neighbour<string>[];
}

/** vec0's own k-nearest search over the whole table. */
function knnSearch(
  store: Store,
  table: string,
  key: string,
  blob: Buffer,
  k: number,
  model: string | undefined,
): unknown[] {
  return store.$client
    .prepare(
      `SELECT ${key} AS id, distance FROM ${table}
       WHERE embedding MATCH ? AND k = ? ${model ? 'AND model = ?' : ''}
       ORDER BY distance`,
    )
    .all(blob, k, ...(model ? [model] : []));
}

/**
 * Exact distances for a subset of vectors, picked by an ordinary join. vec0
 * has no index (its search compares every vector anyway), so this costs no
 * more than the full search, and the filter applies before the top k is
 * taken. `vec_distance_cosine` matches the tables' `distance_metric=cosine`.
 */
function scopedSearch(
  store: Store,
  select: string,
  blob: Buffer,
  videoIds: string[],
  k: number,
  model: string | undefined,
): unknown[] {
  if (videoIds.length === 0) return [];
  return store.$client
    .prepare(
      `${select} ${model ? 'AND e.model = ?' : ''}
       ORDER BY distance LIMIT ?`,
    )
    .all(blob, JSON.stringify(videoIds), ...(model ? [model] : []), k);
}

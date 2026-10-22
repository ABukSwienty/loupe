import { openAsBlob } from 'node:fs';
import { basename } from 'node:path';
import type { UploadInput } from '../infra/worker-client/interface.js';
import type { Video } from '../domains/videos/video.model.js';

/** The file sent to the worker: the low-res copy, or the original if that's all there is. */
export async function videoUpload(video: Video): Promise<UploadInput> {
  const path = video.lowResPath ?? video.filePath;
  if (!path) throw new Error(`Video ${video.id} has not been downloaded yet`);
  return fileUpload(path);
}

export async function fileUpload(path: string): Promise<UploadInput> {
  return { data: await openAsBlob(path), filename: basename(path) };
}

/** Splits rows into batches, e.g. to stay under SQLite's bound-parameter limit or keep worker requests small. */
export function batches<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Rows per INSERT. 500 rows × ~10 columns stays well under SQLite's limit. */
export const INSERT_BATCH = 500;

import { NotFoundException } from '@nestjs/common';

// Shared by the step controllers that serve stored results.

/** 404 unless the video exists. */
export async function requireVideo(
  videos: { findOne(id: string): Promise<unknown> },
  videoId: string,
) {
  if (!(await videos.findOne(videoId))) {
    throw new NotFoundException(`Video ${videoId} not found`);
  }
}

/** The result, or 404 "<step> has not run". */
export function found<T>(result: T | null, step: string): T {
  if (result === null) throw new NotFoundException(`${step} has not run`);
  return result;
}

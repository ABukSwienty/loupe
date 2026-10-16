import type { videos } from '../../infra/store/schema/index.js';

export type Video = typeof videos.$inferSelect;

/** A video without the metadata blob, as returned by list endpoints. */
export type VideoSummary = Omit<Video, 'metadata'>;

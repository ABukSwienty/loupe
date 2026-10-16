import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const videos = sqliteTable('videos', {
  id: text('id').primaryKey(),
  sourceUrl: text('source_url').unique(), // null for local uploads
  platform: text('platform'), // yt-dlp extractor, e.g. "youtube"
  externalId: text('external_id'), // the platform's own id
  title: text('title').notNull(),
  channel: text('channel'),
  channelId: text('channel_id'),
  description: text('description'),
  publishedAt: integer('published_at'),
  duration: real('duration'), // seconds
  /** Original download. Null until downloaded. */
  filePath: text('file_path'),
  /** Low-resolution copy for the ML steps and playback. Null until encoded. */
  lowResPath: text('low_res_path'),
  /** Everything else the source reported (e.g. the yt-dlp info dict). */
  metadata: text('metadata', { mode: 'json' }),
  createdAt: integer('created_at').notNull(),
});

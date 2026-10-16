import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import { videos } from './videos.js';

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const groupVideos = sqliteTable(
  'group_videos',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    videoId: text('video_id')
      .notNull()
      .references(() => videos.id, { onDelete: 'cascade' }),
    addedAt: integer('added_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.videoId] }),
    index('group_videos_video_id_idx').on(t.videoId),
  ],
);

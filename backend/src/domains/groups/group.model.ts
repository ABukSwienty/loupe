import type { groups } from '../../infra/store/schema/index.js';

export type Group = {
  id: string;
  name: string;
  createdAt: number;
  videoIds: string[]; // stored in group_videos
};

export type GroupRow = typeof groups.$inferSelect;

export function toGroup(row: GroupRow, videoIds: string[]): Group {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    videoIds,
  };
}

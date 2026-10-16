DROP INDEX `jobs_state_created_at_idx`;--> statement-breakpoint
-- SQLite needs a default to add a NOT NULL column; existing rows are backfilled
-- in insert order, and the app always sets queue_position on insert.
ALTER TABLE `jobs` ADD `queue_position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `jobs` SET `queue_position` = `rowid`;--> statement-breakpoint
CREATE INDEX `jobs_state_queue_position_idx` ON `jobs` (`state`,`queue_position`);--> statement-breakpoint
CREATE INDEX `jobs_queue_position_idx` ON `jobs` (`queue_position`);

CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`input` text NOT NULL,
	`output` text,
	`error` text,
	`created_at` integer NOT NULL,
	`processed_at` integer,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `jobs_state_created_at_idx` ON `jobs` (`state`,`created_at`);
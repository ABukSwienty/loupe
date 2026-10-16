ALTER TABLE `jobs` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `max_attempts` integer DEFAULT 3 NOT NULL;
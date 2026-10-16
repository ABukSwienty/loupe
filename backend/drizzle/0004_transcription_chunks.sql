CREATE TABLE `transcription_chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transcription_id` text NOT NULL,
	`index` integer NOT NULL,
	`start_segment` integer NOT NULL,
	`end_segment` integer NOT NULL,
	`start` real NOT NULL,
	`end` real NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`transcription_id`) REFERENCES `transcriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transcription_chunks_transcription_id_idx` ON `transcription_chunks` (`transcription_id`,`index`);
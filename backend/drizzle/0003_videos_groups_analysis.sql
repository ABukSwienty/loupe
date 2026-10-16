CREATE TABLE `diarization_segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`diarization_id` text NOT NULL,
	`start` real NOT NULL,
	`end` real NOT NULL,
	`speaker` text NOT NULL,
	`exclusive` integer NOT NULL,
	FOREIGN KEY (`diarization_id`) REFERENCES `diarizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diarization_segments_diarization_id_idx` ON `diarization_segments` (`diarization_id`,`exclusive`,`start`);--> statement-breakpoint
CREATE TABLE `diarizations` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`speakers` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diarizations_video_id_idx` ON `diarizations` (`video_id`);--> statement-breakpoint
CREATE TABLE `ocr_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ocr_result_id` text NOT NULL,
	`text` text NOT NULL,
	`score` real NOT NULL,
	`box` text NOT NULL,
	FOREIGN KEY (`ocr_result_id`) REFERENCES `ocr_results`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ocr_lines_ocr_result_id_idx` ON `ocr_lines` (`ocr_result_id`);--> statement-breakpoint
CREATE TABLE `ocr_results` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`scene_id` text,
	`time` real,
	`image_path` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ocr_results_video_id_idx` ON `ocr_results` (`video_id`);--> statement-breakpoint
CREATE INDEX `ocr_results_scene_id_idx` ON `ocr_results` (`scene_id`);--> statement-breakpoint
CREATE TABLE `scene_detections` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`detector` text NOT NULL,
	`threshold` real,
	`fps` real NOT NULL,
	`duration` real NOT NULL,
	`scene_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scene_detections_video_id_idx` ON `scene_detections` (`video_id`);--> statement-breakpoint
CREATE TABLE `scenes` (
	`id` text PRIMARY KEY NOT NULL,
	`scene_detection_id` text NOT NULL,
	`index` integer NOT NULL,
	`start` real NOT NULL,
	`end` real NOT NULL,
	`start_frame` integer NOT NULL,
	`end_frame` integer NOT NULL,
	`keyframe_time` real,
	`keyframe_path` text,
	FOREIGN KEY (`scene_detection_id`) REFERENCES `scene_detections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scenes_scene_detection_id_idx` ON `scenes` (`scene_detection_id`,`index`);--> statement-breakpoint
CREATE TABLE `transcription_segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transcription_id` text NOT NULL,
	`index` integer NOT NULL,
	`start` real NOT NULL,
	`end` real NOT NULL,
	`text` text NOT NULL,
	`avg_logprob` real NOT NULL,
	`no_speech_prob` real NOT NULL,
	`words` text NOT NULL,
	FOREIGN KEY (`transcription_id`) REFERENCES `transcriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transcription_segments_transcription_id_idx` ON `transcription_segments` (`transcription_id`,`index`);--> statement-breakpoint
CREATE TABLE `transcriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`language` text NOT NULL,
	`language_probability` real NOT NULL,
	`duration` real NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transcriptions_video_id_idx` ON `transcriptions` (`video_id`);--> statement-breakpoint
CREATE TABLE `group_videos` (
	`group_id` text NOT NULL,
	`video_id` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`group_id`, `video_id`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `group_videos_video_id_idx` ON `group_videos` (`video_id`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `videos` (
	`id` text PRIMARY KEY NOT NULL,
	`source_url` text,
	`platform` text,
	`external_id` text,
	`title` text NOT NULL,
	`channel` text,
	`channel_id` text,
	`description` text,
	`published_at` integer,
	`duration` real,
	`file_path` text,
	`low_res_path` text,
	`metadata` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `videos_source_url_unique` ON `videos` (`source_url`);
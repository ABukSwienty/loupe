-- sqlite-vec tables. drizzle-kit can't describe virtual tables, so this file is
-- hand-written and src/infra/store/vectors.ts is the typed way in.
-- Dimensions are fixed per table: a model with a different size needs a new table.

-- bge-m3 vectors of transcription_chunks.
-- vec0 parses its own column list and rejects quoted names.
CREATE VIRTUAL TABLE `chunk_embeddings` USING vec0(
	chunk_id integer PRIMARY KEY,
	model text,
	embedding float[1024] distance_metric=cosine
);
--> statement-breakpoint
-- SigLIP 2 vectors of scene keyframes.
CREATE VIRTUAL TABLE `scene_embeddings` USING vec0(
	scene_id text PRIMARY KEY,
	model text,
	embedding float[768] distance_metric=cosine
);
--> statement-breakpoint
-- Virtual tables can't have foreign keys; these keep them in step with the
-- cascades from videos down to chunks and scenes.
CREATE TRIGGER `transcription_chunks_delete_embedding`
AFTER DELETE ON `transcription_chunks`
BEGIN
	DELETE FROM `chunk_embeddings` WHERE `chunk_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `scenes_delete_embedding`
AFTER DELETE ON `scenes`
BEGIN
	DELETE FROM `scene_embeddings` WHERE `scene_id` = OLD.`id`;
END;

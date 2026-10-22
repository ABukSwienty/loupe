# loupe

A prototype for analysing videos with local ML models: transcripts, speakers, scenes, on-screen text and embeddings for search. `README.md` covers what it is and how to set it up. This file covers how the code works.

It's a prototype. The job queue only needs to be good enough for one machine; in production it would be replaced by BullMQ or similar. Prefer simple over bulletproof.

## Layout

```
frontend/   React 19 + Vite + shadcn. A test client for the ingest and analysis endpoints.
backend/    NestJS 12 API. Owns the database, the job queue, yt-dlp, and the order of the ML steps.
workers/    FastAPI (Python, uv). Wraps the ML models. Stateless: file in, JSON out.
makefile    download-models, dev-workers
```

The Python worker knows nothing about jobs or the database. NestJS queues work, calls the worker over HTTP with long timeouts, and stores the results. Keep it that way: logic goes in NestJS, and the worker only gets new endpoints for new models.

## Running it

```sh
make download-models          # once; needs HF_TOKEN in workers/.env for pyannote
make dev-workers              # FastAPI on :8000
cd backend && npm run start:dev   # NestJS on :3000; creates data/loupe.db and runs migrations
cd frontend && npm run dev        # Vite on :5173; calls the backend at VITE_API_URL
```

The backend needs `yt-dlp` on the PATH (and the ffmpeg it uses for merging).

Backend checks, run from `backend/`:

```sh
npm test                      # vitest, all *.spec.ts
npx tsc --noEmit -p tsconfig.build.json
npm run lint                  # oxlint
```

`test/app.e2e-spec.ts` has a known type error (`supertest/types`) that predates this work.

### Backend environment

| Variable | Default | Used for |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `STORE_PATH` | `data/loupe.db` | SQLite file (relative to `backend/`) |
| `MEDIA_DIR` | `data/media` | Downloaded videos and scene keyframes |
| `LOW_RES_HEIGHT` | `720` | Height cap for the downloaded copy |
| `WORKER_URL` | `http://127.0.0.1:8000` | The Python worker |
| `YT_DLP_PATH` | `yt-dlp` | yt-dlp binary |

`backend/data/` is gitignored and safe to delete; it's recreated on boot.

### Worker models (`workers/src/main.py`, set by environment variables)

| Endpoint | Model | Notes |
|---|---|---|
| `/transcribe` | faster-whisper `large-v3-turbo` | segments + words, language |
| `/diarize` | pyannote `speaker-diarization-community-1` | overlapping and exclusive turns |
| `/scenes` | PySceneDetect | optional base64 JPEG keyframe per scene |
| `/ocr` | RapidOCR | lines with box and score |
| `/embed/image`, `/embed/image-query` | SigLIP 2 base (`google/siglip2-base-patch16-224`), 768 dims | images, and text for searching images |
| `/embed/document` | bge-m3 (`BAAI/bge-m3`), 1024 dims | transcript chunks, for text-to-text search |

SigLIP and bge vectors live in different spaces and are stored in different tables. To search frames by text, embed the query with `/embed/image-query`, not `/embed/document`.

## Backend structure

```
src/
  app/            AppModule: imports InfraModule and DomainsModule
  infra/          Adapters, no business logic. InfraModule re-exports all of them.
    store/        SQLite + Drizzle + sqlite-vec
    queue/        Job queue and the runner that executes jobs
    worker-client/  HTTP client for the Python worker
    yt-dlp/       Runs the yt-dlp binary
  domains/        Features. DomainsModule imports all of them.
    videos/       Ingest + download
    analysis/     Routing: queues the steps' jobs, checks prerequisites, the overview
    transcription/, diarization/, scene-detection/, ocr/, embedding/
                  One domain per ML step: interface + token, service (job handler and
                  result reads), controller for its results, model, module
    jobs/         Queue inspection: list, summary, one job
    groups/       Groups CRUD and membership
    search/       Vector search over transcripts and scenes
```

Conventions:

- **ESM with `nodenext`**: relative imports end in `.js`, even for `.ts` files.
- **Infra behind interfaces**: each adapter has an `interface.ts` with a Symbol token (`STORE`, `JOB_QUEUE`, `WORKER_CLIENT`, `YT_DLP`), injected with `@Inject(TOKEN)`. Domain services are injected by class.
- **Models**: `*.model.ts` holds the type, plus a `toX(row)` mapper where the API shape differs from the row. Many are just `typeof table.$inferSelect`.
- **No validation library**: controllers check request bodies by hand and throw `BadRequestException`. Services throw their own error classes (`VideoNotFoundError`, `MissingPrerequisiteError`, ...), and controllers map those to HTTP errors.
- **Routes**: `common/routes.ts` holds every analysis and step controller's base and paths (`ROUTES.transcription.base`, `.results`, ...). Controllers use it in `@Controller`/`@Get`, and URLs the API returns (`keyframeUrl`) are built from it.
- **Pagination**: `common/pagination.ts`. List endpoints take `?page=&pageSize=` (1-based, default 20, max 100) via `parsePageQuery` and return `Page<T>`: `{ items, total, page, pageSize }`.
- **Tests** sit next to the code as `*.spec.ts`. They use a real in-memory store (`openStore(':memory:')`) and construct services directly with fakes for the worker and yt-dlp; no Nest testing module. Each step domain tests its own service, using `src/testing/analysis-fixture.ts` (store, temp media dir with video `v1`, canned fake worker; excluded from the build). `analysis.service.spec.ts` tests only queueing and prerequisites, with fakes of the `Transcriber`/`SceneDetector` interfaces. Follow `domains/transcription/transcription.service.spec.ts`.
- Prettier is single quotes with trailing commas. Run `npx prettier --write src`.

## The store (`infra/store/`)

- `client.ts`: `openStore(path)` opens better-sqlite3 (WAL, `busy_timeout`, foreign keys on), loads sqlite-vec, and runs migrations from `backend/drizzle/`. `Store` is the Drizzle instance; `store.$client` is the raw connection.
- `schema/`: one file per area, all re-exported from `schema/index.ts`.
- **Queries are synchronous** (better-sqlite3). `store.transaction((tx) => { ... })` takes a synchronous callback.
- Times from the worker are stored as returned: **seconds, as floats**. App timestamps (`created_at` etc.) are unix milliseconds. Enums are text.

### Migrations

1. Change a file in `schema/`.
2. `npm run db:generate -- --name <what_changed>` (from `backend/`).
3. Read the generated SQL. SQLite can't add a `NOT NULL` column without a default; edit the file to add a default and backfill (see `0002_job_queue_position.sql`).

Migrations run on boot. Uncommitted migrations can be regenerated; committed ones are never edited.

`drizzle.config.ts` must point at `schema/index.ts`, not the folder: drizzle-kit loads every file in the folder, including specs, and crashes.

### Vectors (`vectors.ts`, `drizzle/0005_embeddings.sql`)

Drizzle can't describe sqlite-vec virtual tables, so they're in a hand-written migration (`npm run db:generate -- --custom --name <name>`), and `vectors.ts` is the typed way in.

- `chunk_embeddings` (bge-m3, `float[1024]`, keyed by `transcription_chunks.id`) and `scene_embeddings` (SigLIP, `float[768]`, keyed by `scenes.id`). Cosine distance, with a `model` column for filtering.
- `save*Embeddings` replaces existing vectors (vec0 has no upsert) and rejects vectors of the wrong size. `search*Embeddings` returns `{ id, distance }` only; join to the chunk or scene rows yourself.
- Virtual tables can't have foreign keys. `AFTER DELETE` triggers on `transcription_chunks` and `scenes` delete the vectors, so cascades from `videos` still clean up.
- Quirks: vec0 rejects backtick-quoted column names in `CREATE VIRTUAL TABLE`, and integer keys must be bound as `BigInt`.
- A model with a different dimension needs a new table.

### Tables

- `jobs`: the queue (below).
- `videos`: metadata from yt-dlp (`metadata` keeps the full info dict minus large keys), `low_res_path` (the downloaded copy), `file_path` (an original, not set by the current ingest).
- `groups` + `group_videos`: a join table; the `Group` model exposes `videoIds[]`.
- Each analysis step has a parent row per video and child rows. Deleting a video cascades through all of them:

| Step | Parent | Children |
|---|---|---|
| transcribe | `transcriptions` | `transcription_segments`, `transcription_chunks` |
| diarize | `diarizations` | `diarization_segments` (`exclusive` flag) |
| scenes | `scene_detections` | `scenes` (`keyframe_path` to a JPEG on disk) |
| ocr | `ocr_results` (one per keyframe, `scene_id`) | `ocr_lines` |

Chunks are consecutive segments grouped up to 30 seconds (`domains/transcription/chunking.ts`), and are what gets text-embedded.

## The job queue (`infra/queue/`)

- `QueueService` (`JOB_QUEUE`) stores jobs in SQLite. `claim(names)` atomically takes the lowest `queue_position` among queued jobs whose names are given.
- `QueueRunner` runs **one job at a time** and **doesn't poll**. It works through the queue when the app starts and whenever `create()` is called in this process, then goes idle. Jobs inserted by another process are only picked up on the next local `create()` or a restart.
- Register a handler in your module's `onModuleInit`: `runner.register(name, (input, { signal }) => ...)`. Pass `signal` to every worker call so shutdown can abort it. The handler's return value is stored as the job output; keep it a small summary and put the real data in tables.
- **Attempts**: claiming counts as an attempt. A throwing handler is requeued at the back of the queue until `max_attempts` (default 3), then marked failed. On boot, jobs left `processing` by a crash are requeued, or failed if that was their last attempt.
- A handler should return `null` (not throw) when its video was deleted after the job was queued.

## Domains

### Videos (`domains/videos/`): the ingest path

`POST /videos { url }` takes a **YouTube** video URL only (`youtube-url.ts` normalises it). It:

1. Fetches the metadata with yt-dlp and inserts the video. Responds 201 for a new video and 200 if the URL was already ingested. Live and upcoming streams are rejected with 422.
2. Queues a `video.download` job unless the video already has a file or a download is pending. The response is `{ video, jobId }`.

The download handler fetches an mp4 at or below `LOW_RES_HEIGHT` (preferring h264/aac, so there's no re-encode) to `MEDIA_DIR/<videoId>.low.mp4` and sets `low_res_path`.

- `GET /videos?page=&pageSize=`: newest first. Items are `VideoSummary`, the video without the `metadata` blob.
- `GET /videos/:id`: the full video, including `metadata`.
- `GET /videos/:id/media`: the file for playback (`low_res_path`, else `file_path`), 404 until downloaded. `res.sendFile` handles HTTP range requests, which the browser needs to seek.

### Groups (`domains/groups/`)

Named sets of videos, stored in `groups` + `group_videos`. A `Group` is `{ id, name, createdAt, videoIds }`, with `videoIds` in the order they were added.

| Endpoint | Does |
|---|---|
| `POST /groups` `{ name, videoIds? }` | create (201) |
| `GET /groups?page=&pageSize=` | newest first, each with `videoIds` |
| `GET /groups/:id` | one group |
| `PATCH /groups/:id` `{ name?, videoIds? }` | rename and/or replace the members; videos that stay keep their added time |
| `DELETE /groups/:id` | 204; the videos are not deleted |
| `GET /groups/:id/videos?page=&pageSize=` | the members as `VideoSummary`, in added order |
| `POST /groups/:id/videos` `{ videoIds }` | add (200); ones already in the group are skipped |
| `DELETE /groups/:id/videos/:videoId` | remove one (204), or 404 if it wasn't in the group |

Names are trimmed and must be 1-200 characters. Duplicate ids in `videoIds` are dropped. Unknown video ids are a 400 naming them, and nothing changes, because each write is one transaction. Deleting a video removes it from its groups.

### Analysis (`domains/analysis/`)

One endpoint per step. Each queues a job and responds **202** `{ jobId }`, or **200** with the existing job's id if the same step is already queued or running for that video (the new parameters are ignored).

| Endpoint | Body (all optional) | Needs | Job name |
|---|---|---|---|
| `POST /videos/:id/transcribe` | `language` | a file | `analysis.transcribe` |
| `POST /videos/:id/diarize` | `numSpeakers`, `minSpeakers`, `maxSpeakers` | a file | `analysis.diarize` |
| `POST /videos/:id/scenes` | `detector` (`adaptive`/`content`), `threshold`, `keyframeWidth` | a file | `analysis.scenes` |
| `POST /videos/:id/ocr` | | scenes | `analysis.ocr` |
| `POST /videos/:id/embeddings/transcript` | | a transcription | `analysis.embed-transcript` |
| `POST /videos/:id/embeddings/scenes` | | scenes | `analysis.embed-scenes` |

- **Prerequisites** are checked when the job is queued: 409 if a prerequisite neither exists nor is queued, 404 for an unknown video, 400 for bad parameters. A queued prerequisite counts because jobs run in order, so ingest → scenes → OCR can be requested back to back.
- **Re-running a step replaces** that video's previous result, and the delete cascades: re-transcribing drops the transcript embeddings, and re-running scenes drops the OCR results, scene embeddings and old keyframe files. Nothing re-queues those steps automatically.
- Keyframes are written to `MEDIA_DIR/keyframes/<videoId>/<sceneDetectionId>/0000.jpg`. The worker's base64 is never stored.
- The worker gets the low-res copy (`low_res_path`, falling back to `file_path`).
- `analysis/` is only the router: it queues jobs, checks prerequisites and registers handlers. Each step is its own top-level domain (`domains/transcription/`, `diarization/`, `scene-detection/`, `ocr/`, `embedding/`) with an `interface.ts` holding a Symbol token (`TRANSCRIBER`, `DIARIZER`, `SCENE_DETECTOR`, `OCR_READER`, `EMBEDDER`) and the step's job input type, the service implementing it, and a module that binds the token with `useClass` and exports it. To swap an implementation, change that module. Each step's service also reads its own results and has a `summary(videoId)` (embedding has `coverage(videoId)`), which `AnalysisService.overview` combines. `AnalysisModule` imports the step modules and registers the job handlers; everything injects the interface with `@Inject(TOKEN)`. OCR and embedding import `SceneDetectionModule` for `keyframeScenes`. `analysis.jobs.ts` builds `AnalysisJobInputs` from the steps' input types, so steps never import from `analysis/`. The upload and batching helpers they share are in `common/media.ts`.
- To add a step: create `domains/<step>/` with an `interface.ts` (token, input type, interface), the service and its module, add the name and input to `analysis.jobs.ts`, import the module in `AnalysisModule` and register the handler in `onModuleInit`, add the prerequisite in `AnalysisService.checkPrerequisite`, and add an endpoint to `AnalysisController`.

### Analysis results (each step's `*.controller.ts`)

Read-only. Each returns 404 for an unknown video, and 404 `"<step> has not run"` when the step has no result. There's at most one result per step per video, since re-running replaces it. Times are seconds.

| Endpoint | Returns |
|---|---|
| `GET /videos/:id/analysis` (analysis) | `AnalysisOverview`: per step, null or `{ id, createdAt, counts }`, plus embedding coverage (`embedded` of `total`, and `models`) for transcript chunks and scene keyframes. Cheap; use it to show what's done. |
| `GET /transcription/:videoId` | The transcription with ordered segments, including words. `?include=chunks` adds the 30-second chunks. |
| `GET /diarization/:videoId` | `speakers`, `segments` (overlapping) and `exclusiveSegments`. |
| `GET /scenes/:videoId` | The detection with ordered scenes. Each has a `keyframeUrl`, a path relative to the API base; file paths are never exposed. |
| `GET /scenes/:videoId/:sceneId/keyframe` | The JPEG, cached as immutable (scene ids change when scenes re-run). |
| `GET /ocr/:videoId` | One result per keyframe in video order, each with `sceneId`, `time` and `lines`. |

Vectors aren't exposed; they're only useful through search. Transcript segments don't carry speakers yet. To add them, match each segment to the exclusive diarization turn it overlaps most, which would fit as `?include=speakers`.

### Search (`domains/search/`)

`GET /search/transcripts?q=&k=&groupId=&videoId=` and `GET /search/scenes?q=&k=&groupId=&videoId=` (`k` defaults to 10, max 50).

- **Scope**: without `groupId` or `videoId` a search covers all videos. `groupId` limits it to the group's videos, and `videoId` to one video. With both, it covers that video only if it's in the group, otherwise nothing. An unknown group or video is a 404, returned before the worker is called.

- **Transcripts:** the query is embedded with bge-m3 (`embedDocuments`) and matched against `chunk_embeddings`. Each hit has its `video` (id, title, channel), the `chunk` (start, end, text) and its `segments`, without words.
- **Scenes:** the query is embedded with SigLIP's text side (`embedImageQueries`) and matched against `scene_embeddings`. Each hit has its `video` and the `scene` with its `keyframeUrl`.
- Responses are `{ query, model, hits }`, ordered closest first. `distance` is cosine distance, lower is closer. Only vectors from the model that embedded the query are compared.
- **Don't threshold on distance.** SigLIP text-to-image distances cluster around 0.85-0.95 even for good matches, while bge-m3 text distances run about 0.35-0.6. Distances are only comparable within one search.
- The query embedding is a synchronous worker call made during the request, not a job. Worker errors and an unreachable worker become 502.
- **How scoping works** (`vectors.ts`): an unscoped search uses vec0's `MATCH ... AND k = ?`. A scoped one picks the scope's vectors with an ordinary join and ranks them with `vec_distance_cosine`. vec0 has no index and compares every vector anyway, so scoping costs nothing extra, and the filter applies *before* the top k is taken. Filtering a global top k afterwards would miss matches. Distances are identical either way.

### Jobs (`domains/jobs/`)

- `GET /jobs?state=&name=&videoId=&page=&pageSize=`, all optional. `videoId` matches `input.videoId`, so it finds every job for a video. With `state=queued`, jobs are listed in the order they will run (`queue_position`); otherwise newest first.
- `GET /jobs/summary`: `{ counts, running, next }`. That's the count per state, the job(s) in `processing`, and the next 10 queued, in run order.
- `GET /jobs/:id`: one job, with `state`, `attempts`, `output` (a summary such as `{ segments: 120, chunks: 14 }`) or `error`.

## Frontend (`frontend/`)

A test client, not the product UI. It calls the backend directly (`VITE_API_URL`, default `http://localhost:3000`); the backend allows any origin with `enableCors()`. No auth.

- `src/lib/api.ts`: `fetch` wrappers and types copied from the backend models. Keep them in sync by hand. Responses carry their status, so the UI can tell 200 from 201/202.
- `src/hooks/use-api.ts`: one hook per endpoint (`useVideo`, `useVideos`, `useJob`, `useJobs`, `useJobSummary`) on top of `useFetch`. Job hooks poll every 1.5s while something is queued or processing.
- `src/lib/refresh.ts`: `invalidate()` makes every mounted hook refetch. Call it after a mutation (ingest, queueing a step) so the sidebar and lists catch up.
- Pages: `/` ingest, `/videos` (paged), `/videos/:id`, `/search`, `/jobs` (queue summary, paged list filterable by state), `/jobs/:id`.
- `/videos/:id` has tabs, kept in `?tab=`: Run (a card per step with its body fields, latest job and a result summary from `GET /videos/:id/analysis`, plus "Queue all steps"), Transcript, Speakers, Scenes, OCR. The viewers are in `src/components/results/`. Search hits link to `?tab=transcript#seg-<index>` or `?tab=scenes#scene-<id>`; `useScrollToHash` scrolls there once the result loads.
- `/search?q=&k=&in=video:<id>|group:<id>` runs `/search/transcripts` and `/search/scenes` in parallel.
- Dark by default (next-themes, `class` on `<html>`); the sidebar footer toggles light. Speaker colours are `--speaker-1..8` in `index.css`, a CVD-checked categorical palette per theme; speakers are always labelled too, as some light-mode colours are under 3:1.
- The video page plays the file (`components/player.tsx`). `PlayerProvider` shares `seek()` and the current time through two contexts in `lib/player.ts`, kept apart so only playhead components re-render on time updates (memoize long lists, like the transcript rows). `Timestamp` seeks when there is a player, and links to YouTube at that time otherwise. `Timeline` (`components/results/timeline.tsx`) draws time ranges in lanes with a playhead: pressing an item seeks to its start, pressing elsewhere seeks there, dragging scrubs, and the arrow keys step 5s. `?t=<seconds>` starts the player there; search hits use it.
- OCR boxes are drawn in an SVG over the keyframe, in the keyframe's pixels. The overlay's box must be exactly the image's size, or the boxes shift.
- Components come from shadcn (`npx shadcn@latest add <name>`, Radix base, Nova preset) into `src/components/ui/`, which eslint ignores. Path alias `@/` is `src/`.

Checks, from `frontend/`: `npm run build` (tsc + vite) and `npm run lint`.

## Not built yet

- Seeking: the player should use the `start`/`end` seconds; frame numbers depend on the fps of the file the step ran on.
- A pipeline endpoint that queues every step for a video after its download.

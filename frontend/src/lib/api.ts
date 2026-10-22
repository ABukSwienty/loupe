// Thin client for the NestJS backend. Types mirror the backend models
// (backend/src/domains/videos/video.model.ts, infra/queue/job.model.ts).

export const API_URL: string =
  import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export type Video = {
  id: string
  sourceUrl: string | null
  platform: string | null
  externalId: string | null
  title: string
  channel: string | null
  channelId: string | null
  description: string | null
  publishedAt: number | null
  duration: number | null // seconds
  filePath: string | null
  lowResPath: string | null
  metadata: Record<string, unknown> | null
  createdAt: number // unix ms
}

/** A video without the metadata blob, as returned by GET /videos. */
export type VideoSummary = Omit<Video, 'metadata'>

/** A page of a list endpoint. `page` is 1-based. */
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number }

export type PageQuery = { page?: number; pageSize?: number }

export type JobState = 'queued' | 'processing' | 'failed' | 'completed'

export type Job = {
  id: string
  createdAt: number
  processedAt: number | null
  completedAt: number | null
  name: string
  state: JobState
  input: unknown
  output: unknown
  error: string | null
  attempts: number
  maxAttempts: number
}

export const JOB_STATES: JobState[] = ['queued', 'processing', 'completed', 'failed']

export type JobSummary = {
  counts: Record<JobState, number>
  running: Job[]
  next: Job[] // queued, in the order they will run
}

export function isFinished(state: JobState): boolean {
  return state === 'completed' || state === 'failed'
}

/** The video a job is for, if its input names one. */
export function videoIdOf(input: unknown): string | null {
  if (input && typeof input === 'object' && 'videoId' in input) {
    const { videoId } = input as { videoId: unknown }
    if (typeof videoId === 'string') return videoId
  }
  return null
}

/** A non-2xx response. `message` is Nest's error message when it sent one. */
export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

/** A successful response, with its status so callers can tell 200 from 201/202. */
export type ApiResponse<T> = { status: number; data: T }

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const data: unknown = text ? JSON.parse(text) : null
  if (!res.ok) {
    throw new ApiError(res.status, errorMessage(data, res.statusText), data)
  }
  return { status: res.status, data: data as T }
}

function errorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'message' in data) {
    const { message } = data as { message: unknown }
    if (typeof message === 'string') return message
    if (Array.isArray(message)) return message.join(', ')
  }
  return fallback
}

/** Drops undefined and empty values. */
function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const s = search.toString()
  return s ? `?${s}` : ''
}

export function ingestVideo(url: string) {
  return request<{ video: Video; jobId: string | null }>('POST', '/videos', {
    url,
  })
}

export async function getVideo(id: string): Promise<Video> {
  return (await request<Video>('GET', `/videos/${encodeURIComponent(id)}`))
    .data
}

/** Newest first. */
export async function listVideos(query: PageQuery = {}): Promise<Page<VideoSummary>> {
  return (await request<Page<VideoSummary>>('GET', `/videos${queryString(query)}`)).data
}

/** Queued jobs in the order they will run when filtered by that state; otherwise newest first. */
export async function listJobs(
  query: PageQuery & { state?: JobState; name?: string; videoId?: string } = {},
): Promise<Page<Job>> {
  return (await request<Page<Job>>('GET', `/jobs${queryString(query)}`)).data
}

export async function getJobSummary(): Promise<JobSummary> {
  return (await request<JobSummary>('GET', '/jobs/summary')).data
}

export async function getJob(id: string): Promise<Job> {
  return (await request<Job>('GET', `/jobs/${encodeURIComponent(id)}`)).data
}

// Analysis steps, in the order they're usually run. `path` is relative to
// /videos/:id.

export type AnalysisStep =
  | 'transcribe'
  | 'diarize'
  | 'scenes'
  | 'ocr'
  | 'embedTranscript'
  | 'embedScenes'

export const ANALYSIS_STEPS: Record<
  AnalysisStep,
  { path: string; jobName: string; title: string; needs: string }
> = {
  transcribe: {
    path: 'transcribe',
    jobName: 'analysis.transcribe',
    title: 'Transcribe',
    needs: 'a file',
  },
  diarize: {
    path: 'diarize',
    jobName: 'analysis.diarize',
    title: 'Diarize',
    needs: 'a file',
  },
  scenes: {
    path: 'scenes',
    jobName: 'analysis.scenes',
    title: 'Detect scenes',
    needs: 'a file',
  },
  ocr: { path: 'ocr', jobName: 'analysis.ocr', title: 'OCR', needs: 'scenes' },
  embedTranscript: {
    path: 'embeddings/transcript',
    jobName: 'analysis.embed-transcript',
    title: 'Embed transcript',
    needs: 'a transcription',
  },
  embedScenes: {
    path: 'embeddings/scenes',
    jobName: 'analysis.embed-scenes',
    title: 'Embed scenes',
    needs: 'scenes',
  },
}

/** Responds 202 for a new job, 200 if the step was already queued or running. */
export function runAnalysisStep(
  videoId: string,
  step: AnalysisStep,
  body: Record<string, unknown> = {},
) {
  return request<{ jobId: string }>(
    'POST',
    `/videos/${encodeURIComponent(videoId)}/${ANALYSIS_STEPS[step].path}`,
    body,
  )
}

// Analysis results (backend/src/domains/<step>/*.model.ts, the overview in
// analysis/analysis.model.ts). Times are seconds into the video. Each responds
// 404 when its step hasn't run.

/** An absolute URL for a path the API returns, such as a scene's keyframeUrl. */
export function apiUrl(path: string): string {
  return `${API_URL}${path}`
}

export function isNotRun(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404 && err.message.endsWith('has not run')
}

export type AnalysisOverview = {
  transcription: { id: string; createdAt: number; language: string; segments: number; chunks: number } | null
  diarization: { id: string; createdAt: number; speakers: number; segments: number } | null
  scenes: { id: string; createdAt: number; scenes: number; keyframes: number } | null
  ocr: { createdAt: number; images: number; lines: number } | null
  embeddings: {
    transcript: { embedded: number; total: number; models: string[] }
    scenes: { embedded: number; total: number; models: string[] }
  }
}

export type TranscriptWord = { start: number; end: number; word: string; probability: number }

export type TranscriptionSegment = {
  index: number
  start: number
  end: number
  text: string
  avgLogprob: number
  noSpeechProb: number
  words: TranscriptWord[]
}

export type TranscriptionChunk = {
  id: number
  transcriptionId: string
  index: number
  startSegment: number // inclusive
  endSegment: number // inclusive
  start: number
  end: number
  text: string
}

export type Transcription = {
  id: string
  videoId: string
  language: string
  languageProbability: number
  duration: number
  createdAt: number
  segments: TranscriptionSegment[]
  chunks?: TranscriptionChunk[]
}

export type SpeakerTurn = { start: number; end: number; speaker: string }

export type Diarization = {
  id: string
  videoId: string
  speakers: string[]
  createdAt: number
  segments: SpeakerTurn[] // may overlap
  exclusiveSegments: SpeakerTurn[] // one speaker at a time
}

export type Scene = {
  id: string
  index: number
  start: number
  end: number
  startFrame: number
  endFrame: number
  keyframeTime: number | null
  keyframeUrl: string | null // relative to API_URL
}

export type SceneDetection = {
  id: string
  videoId: string
  detector: 'adaptive' | 'content'
  threshold: number | null
  fps: number
  duration: number
  sceneCount: number
  createdAt: number
  scenes: Scene[]
}

export type OcrLine = { text: string; score: number; box: [number, number][] }

export type OcrResult = {
  id: string
  videoId: string
  sceneId: string | null
  time: number | null
  createdAt: number
  lines: OcrLine[]
}

const videoPath = (videoId: string) => `/videos/${encodeURIComponent(videoId)}`

/** The source's thumbnail, from the yt-dlp metadata. */
export function thumbnailUrl(video: Video): string | null {
  const url = video.metadata?.thumbnail
  return typeof url === 'string' ? url : null
}

/** The playable file (GET /videos/:id/media, with range support), once downloaded. */
export function mediaUrl(video: Pick<Video, 'id' | 'lowResPath' | 'filePath'>): string | null {
  return video.lowResPath || video.filePath ? apiUrl(`${videoPath(video.id)}/media`) : null
}

export async function getAnalysisOverview(videoId: string): Promise<AnalysisOverview> {
  return (await request<AnalysisOverview>('GET', `${videoPath(videoId)}/analysis`)).data
}

/** Always includes the chunks. */
export async function getTranscription(videoId: string): Promise<Transcription> {
  return (await request<Transcription>('GET', `/transcription/${encodeURIComponent(videoId)}?include=chunks`)).data
}

export async function getDiarization(videoId: string): Promise<Diarization> {
  return (await request<Diarization>('GET', `/diarization/${encodeURIComponent(videoId)}`)).data
}

export async function getScenes(videoId: string): Promise<SceneDetection> {
  return (await request<SceneDetection>('GET', `/scenes/${encodeURIComponent(videoId)}`)).data
}

export async function getOcr(videoId: string): Promise<OcrResult[]> {
  return (await request<OcrResult[]>('GET', `/ocr/${encodeURIComponent(videoId)}`)).data
}

// Groups and search (backend/src/domains/search/search.model.ts).

export type Group = { id: string; name: string; createdAt: number; videoIds: string[] }

export async function listGroups(query: PageQuery = {}): Promise<Page<Group>> {
  return (await request<Page<Group>>('GET', `/groups${queryString(query)}`)).data
}

export type SearchVideo = { id: string; title: string; channel: string | null }

/** Cosine distance: 0 is the same direction, 2 the opposite. Lower is closer. */
export type TranscriptHit = {
  distance: number
  video: SearchVideo
  chunk: { id: number; index: number; start: number; end: number; text: string }
  segments: Omit<TranscriptionSegment, 'words'>[]
}

export type SceneHit = { distance: number; video: SearchVideo; scene: Scene }

export type SearchResponse<Hit> = { query: string; model: string; hits: Hit[] }

export type SearchQuery = { q: string; k?: number; videoId?: string; groupId?: string }

/** What is said: transcript chunks closest in meaning to `q`. */
export async function searchTranscripts(query: SearchQuery): Promise<SearchResponse<TranscriptHit>> {
  return (await request<SearchResponse<TranscriptHit>>('GET', `/search/transcripts${queryString(query)}`)).data
}

/** What is shown: scene keyframes that best match the description `q`. */
export async function searchScenes(query: SearchQuery): Promise<SearchResponse<SceneHit>> {
  return (await request<SearchResponse<SceneHit>>('GET', `/search/scenes${queryString(query)}`)).data
}

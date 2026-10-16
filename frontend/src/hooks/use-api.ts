import { useMemo } from 'react'
import { useFetch } from '@/hooks/use-fetch'
import {
  getAnalysisOverview,
  getDiarization,
  getJob,
  getJobSummary,
  getOcr,
  getScenes,
  getTranscription,
  getVideo,
  isFinished,
  listGroups,
  listJobs,
  listVideos,
  searchScenes,
  searchTranscripts,
  type Job,
  type JobState,
  type JobSummary,
  type Page,
  type SearchQuery,
} from '@/lib/api'

const unfinished = (job: Job) => !isFinished(job.state)
const pagePending = (page: Page<Job>) => page.items.some(unfinished)
const queueBusy = (s: JobSummary) => s.counts.queued + s.counts.processing > 0

export function useVideo(id: string | undefined) {
  const fetcher = useMemo(() => (id ? () => getVideo(id) : null), [id])
  return useFetch(fetcher)
}

export function useVideos(page = 1, pageSize = 20) {
  const fetcher = useMemo(() => () => listVideos({ page, pageSize }), [page, pageSize])
  return useFetch(fetcher)
}

/** Polls until the job completes or fails. */
export function useJob(id: string | null | undefined) {
  const fetcher = useMemo(() => (id ? () => getJob(id) : null), [id])
  return useFetch(fetcher, unfinished)
}

/** Polls while any job on the page is queued or processing. */
export function useJobs(query: {
  page?: number
  pageSize?: number
  state?: JobState
  videoId?: string
}) {
  const { page, pageSize, state, videoId } = query
  const fetcher = useMemo(
    () => () => listJobs({ page, pageSize, state, videoId }),
    [page, pageSize, state, videoId],
  )
  return useFetch(fetcher, pagePending)
}

/** Polls while anything is queued or processing. */
export function useJobSummary() {
  const fetcher = useMemo(() => getJobSummary, [])
  return useFetch(fetcher, queueBusy)
}

export function useAnalysisOverview(videoId: string | undefined) {
  const fetcher = useMemo(() => (videoId ? () => getAnalysisOverview(videoId) : null), [videoId])
  return useFetch(fetcher)
}

export function useTranscription(videoId: string) {
  const fetcher = useMemo(() => () => getTranscription(videoId), [videoId])
  return useFetch(fetcher)
}

export function useDiarization(videoId: string) {
  const fetcher = useMemo(() => () => getDiarization(videoId), [videoId])
  return useFetch(fetcher)
}

export function useScenes(videoId: string) {
  const fetcher = useMemo(() => () => getScenes(videoId), [videoId])
  return useFetch(fetcher)
}

export function useOcr(videoId: string) {
  const fetcher = useMemo(() => () => getOcr(videoId), [videoId])
  return useFetch(fetcher)
}

export function useGroups() {
  const fetcher = useMemo(() => () => listGroups({ pageSize: 100 }), [])
  return useFetch(fetcher)
}

/** Both searches for the same query, in parallel. Pass null to search nothing. */
export function useSearch(query: SearchQuery | null) {
  const { q, k, videoId, groupId } = query ?? {}
  const transcriptFetcher = useMemo(
    () => (q ? () => searchTranscripts({ q, k, videoId, groupId }) : null),
    [q, k, videoId, groupId],
  )
  const sceneFetcher = useMemo(
    () => (q ? () => searchScenes({ q, k, videoId, groupId }) : null),
    [q, k, videoId, groupId],
  )
  return { transcripts: useFetch(transcriptFetcher), scenes: useFetch(sceneFetcher) }
}

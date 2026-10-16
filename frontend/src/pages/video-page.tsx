import { DownloadIcon, ListOrderedIcon, Loader2Icon, RefreshCwIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { AnalysisStepCard } from '@/components/analysis-step-card'
import { JobSummary } from '@/components/job-summary'
import { PageHeader } from '@/components/page-header'
import { OcrView } from '@/components/results/ocr-view'
import { ScenesView } from '@/components/results/scenes-view'
import { SpeakersView } from '@/components/results/speakers-view'
import { TranscriptView } from '@/components/results/transcript-view'
import { PlayerProvider, VideoPlayer } from '@/components/player'
import { VideoCard } from '@/components/video-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAnalysisOverview, useJobs, useVideo } from '@/hooks/use-api'
import { queueStep } from '@/lib/analysis'
import {
  ANALYSIS_STEPS,
  ingestVideo,
  isFinished,
  mediaUrl,
  thumbnailUrl,
  type AnalysisOverview,
  type AnalysisStep,
  type Job,
  type Video,
} from '@/lib/api'
import { describeError, toastError } from '@/lib/errors'
import { invalidate } from '@/lib/refresh'

const STEPS = Object.keys(ANALYSIS_STEPS) as AnalysisStep[]
const DOWNLOAD_JOB = 'video.download'
const TABS = ['run', 'transcript', 'speakers', 'scenes', 'ocr'] as const
type Tab = (typeof TABS)[number]

/** One line per step describing its stored result, or null if it hasn't run. */
function resultSummary(o: AnalysisOverview | null, step: AnalysisStep): string | null {
  if (!o) return null
  const embedded = ({ embedded, total }: { embedded: number; total: number }) =>
    embedded > 0 ? `${embedded}/${total} embedded` : null
  switch (step) {
    case 'transcribe':
      return o.transcription && `${o.transcription.segments} segments · ${o.transcription.language}`
    case 'diarize':
      return o.diarization && `${o.diarization.speakers} speakers · ${o.diarization.segments} turns`
    case 'scenes':
      return o.scenes && `${o.scenes.scenes} scenes · ${o.scenes.keyframes} keyframes`
    case 'ocr':
      return o.ocr && `${o.ocr.lines} lines in ${o.ocr.images} keyframes`
    case 'embedTranscript':
      return embedded(o.embeddings.transcript)
    case 'embedScenes':
      return embedded(o.embeddings.scenes)
  }
}

export function VideoPage() {
  const { id } = useParams<{ id: string }>()
  const [params, setParams] = useSearchParams()
  const tab: Tab = TABS.find((t) => t === params.get('tab')) ?? 'run'
  // ?t= starts the player there, e.g. from a search hit.
  const startAt = Number(params.get('t')) || undefined
  const { data: video, error, loading } = useVideo(id)
  const { data: overview } = useAnalysisOverview(id)
  // Newest first, so the first job per name is the latest run of that step.
  const { data: jobs } = useJobs({ videoId: id, pageSize: 100 })
  const [queueingAll, setQueueingAll] = useState(false)

  const latest = new Map<string, Job>()
  for (const job of jobs?.items ?? []) {
    if (!latest.has(job.name)) latest.set(job.name, job)
  }

  // Refetch the video and its results whenever one of its jobs finishes.
  const finished = jobs?.items.filter((j) => isFinished(j.state)).length
  const lastFinished = useRef(finished)
  useEffect(() => {
    if (lastFinished.current !== undefined && finished !== undefined && finished > lastFinished.current) {
      invalidate()
    }
    lastFinished.current = finished
  }, [finished])

  // Jobs run in order and a queued prerequisite counts, so every step can be
  // queued back to back with its defaults.
  async function queueAll() {
    if (!id) return
    setQueueingAll(true)
    for (const step of STEPS) {
      if (!(await queueStep(id, step))) break
    }
    setQueueingAll(false)
  }

  return (
    <>
      <PageHeader title={video?.title ?? 'Video'}>
        <Button variant="outline" size="sm" onClick={invalidate}>
          <RefreshCwIcon />
          Refresh
        </Button>
        <Button size="sm" onClick={queueAll} disabled={!video || queueingAll}>
          {queueingAll ? <Loader2Icon className="animate-spin" /> : <ListOrderedIcon />}
          Queue all steps
        </Button>
      </PageHeader>
      <div className="flex flex-col gap-6 p-4 md:p-6">
        {loading && <Skeleton className="h-64 w-full" />}
        {error && <p className="text-destructive text-sm">{describeError(error)}</p>}
        {video && (
          <PlayerProvider available={mediaUrl(video) !== null}>
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              {/* Sticky, so the player stays in view while scrolling through results. */}
              <div className="flex flex-col gap-4 lg:sticky lg:top-20">
                <VideoPlayer src={mediaUrl(video)} poster={thumbnailUrl(video) ?? undefined} initialTime={startAt} />
                <VideoCard video={video} showThumbnail={false} />
              </div>
              <Tabs value={tab} onValueChange={(t) => setParams(t === 'run' ? {} : { tab: t }, { replace: true })}>
                <TabsList>
                  <TabsTrigger value="run">Run</TabsTrigger>
                  <TabsTrigger value="transcript" disabled={!overview?.transcription}>
                    Transcript
                  </TabsTrigger>
                  <TabsTrigger value="speakers" disabled={!overview?.diarization}>
                    Speakers
                  </TabsTrigger>
                  <TabsTrigger value="scenes" disabled={!overview?.scenes}>
                    Scenes
                  </TabsTrigger>
                  <TabsTrigger value="ocr" disabled={!overview?.ocr}>
                    OCR
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="run" className="flex flex-col gap-4 pt-2">
                  <DownloadCard video={video} job={latest.get(DOWNLOAD_JOB)} />
                  <div className="grid gap-4 2xl:grid-cols-2">
                    {STEPS.map((step) => (
                      <AnalysisStepCard
                        key={step}
                        videoId={video.id}
                        step={step}
                        latestJob={latest.get(ANALYSIS_STEPS[step].jobName)}
                        result={resultSummary(overview, step)}
                      />
                    ))}
                  </div>
                </TabsContent>
                <TabsContent value="transcript" className="pt-2">
                  <TranscriptView video={video} />
                </TabsContent>
                <TabsContent value="speakers" className="pt-2">
                  <SpeakersView video={video} />
                </TabsContent>
                <TabsContent value="scenes" className="pt-2">
                  <ScenesView video={video} />
                </TabsContent>
                <TabsContent value="ocr" className="pt-2">
                  <OcrView video={video} />
                </TabsContent>
              </Tabs>
            </div>
          </PlayerProvider>
        )}
      </div>
    </>
  )
}

function DownloadCard({ video, job }: { video: Video; job: Job | undefined }) {
  const [pending, setPending] = useState(false)

  // Re-ingesting a known URL queues the download again if it has no file and
  // none is pending.
  async function retry() {
    if (!video.sourceUrl) return
    setPending(true)
    try {
      await ingestVideo(video.sourceUrl)
      invalidate()
    } catch (err) {
      toastError('Re-ingest failed', err)
    } finally {
      setPending(false)
    }
  }

  if (video.lowResPath) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Download</CardTitle>
        <CardDescription>The analysis steps that need a file can be queued before it finishes.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {job && <JobSummary job={job} />}
        {video.sourceUrl && (!job || job.state === 'failed') && (
          <Button variant="outline" size="sm" className="w-fit" onClick={retry} disabled={pending}>
            {pending ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
            Queue download
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

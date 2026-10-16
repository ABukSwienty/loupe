import { Loader2Icon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { JobSummary } from '@/components/job-summary'
import { PageHeader } from '@/components/page-header'
import { VideoCard } from '@/components/video-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useJob } from '@/hooks/use-api'
import { ingestVideo, type Video } from '@/lib/api'
import { describeError } from '@/lib/errors'
import { invalidate } from '@/lib/refresh'

type Result = { status: number; video: Video; jobId: string | null }

export function IngestPage() {
  const [url, setUrl] = useState('')
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    setResult(null)
    try {
      const { status, data } = await ingestVideo(url.trim())
      invalidate()
      setResult({ status, ...data })
    } catch (err) {
      setError(describeError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <PageHeader title="Ingest" />
      <div className="flex max-w-3xl flex-col gap-6 p-4 md:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Ingest a YouTube video</CardTitle>
            <CardDescription>
              <code className="font-mono">POST /videos</code> fetches the metadata with yt-dlp, then queues a
              download of a low-resolution copy.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="flex flex-col gap-2">
              <Label htmlFor="url">Video URL</Label>
              <div className="flex gap-2">
                <Input
                  id="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=…"
                  autoComplete="off"
                />
                <Button type="submit" disabled={pending || !url.trim()}>
                  {pending && <Loader2Icon className="animate-spin" />}
                  Ingest
                </Button>
              </div>
              {pending && (
                <p className="text-muted-foreground text-sm">Waiting for yt-dlp to fetch the metadata…</p>
              )}
              {error && <p className="text-destructive text-sm">{error}</p>}
            </form>
          </CardContent>
        </Card>

        {result && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="secondary">{result.status}</Badge>
              {result.status === 201 ? 'New video ingested.' : 'Already ingested.'}
              {!result.jobId &&
                (result.video.lowResPath
                  ? ' It has already been downloaded.'
                  : ' A download is already pending.')}
            </div>
            <VideoCard video={result.video} link />
            {result.jobId && (
              <Card>
                <CardHeader>
                  <CardTitle>Download</CardTitle>
                </CardHeader>
                <CardContent>
                  <DownloadJob jobId={result.jobId} />
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </>
  )
}

function DownloadJob({ jobId }: { jobId: string }) {
  const { data: job, error } = useJob(jobId)
  if (error) return <p className="text-destructive text-sm">{describeError(error)}</p>
  return job ? <JobSummary job={job} /> : null
}

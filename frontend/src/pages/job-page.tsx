import { Link, useParams } from 'react-router'
import { JobStateBadge } from '@/components/job-state-badge'
import { JsonView } from '@/components/json-view'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useJob } from '@/hooks/use-api'
import { videoIdOf } from '@/lib/api'
import { describeError } from '@/lib/errors'
import { formatTimestamp } from '@/lib/format'


export function JobPage() {
  const { id } = useParams<{ id: string }>()
  const { data: job, error } = useJob(id)
  const videoId = videoIdOf(job?.input)

  return (
    <>
      <PageHeader title={job ? job.name : 'Job'}>{job && <JobStateBadge state={job.state} />}</PageHeader>
      <div className="flex max-w-4xl flex-col gap-6 p-4 md:p-6">
        {error && <p className="text-destructive text-sm">{describeError(error)}</p>}
        {!job && !error && <Skeleton className="h-48 w-full" />}
        {job && (
          <>
            <Card>
              <CardContent>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">ID</dt>
                  <dd className="font-mono text-xs break-all">{job.id}</dd>
                  <dt className="text-muted-foreground">Video</dt>
                  <dd>
                    {videoId ? (
                      <Link to={`/videos/${videoId}`} className="font-mono text-xs underline-offset-4 hover:underline">
                        {videoId}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </dd>
                  <dt className="text-muted-foreground">Attempts</dt>
                  <dd>
                    {job.attempts}/{job.maxAttempts}
                  </dd>
                  <dt className="text-muted-foreground">Created</dt>
                  <dd>{formatTimestamp(job.createdAt)}</dd>
                  <dt className="text-muted-foreground">Processed</dt>
                  <dd>{formatTimestamp(job.processedAt)}</dd>
                  <dt className="text-muted-foreground">Completed</dt>
                  <dd>{formatTimestamp(job.completedAt)}</dd>
                </dl>
              </CardContent>
            </Card>
            {job.error && (
              <Card>
                <CardHeader>
                  <CardTitle>Error</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-destructive font-mono text-xs break-all whitespace-pre-wrap">{job.error}</p>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader>
                <CardTitle>Input</CardTitle>
              </CardHeader>
              <CardContent>
                <JsonView value={job.input} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Output</CardTitle>
              </CardHeader>
              <CardContent>
                {job.output == null ? (
                  <p className="text-muted-foreground text-sm">None yet.</p>
                ) : (
                  <JsonView value={job.output} />
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  )
}

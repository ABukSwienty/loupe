import { useState } from 'react'
import { Link } from 'react-router'
import { JobStateBadge } from '@/components/job-state-badge'
import { PageHeader } from '@/components/page-header'
import { Pager } from '@/components/pager'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useJobs, useJobSummary } from '@/hooks/use-api'
import { JOB_STATES, videoIdOf, type Job, type JobState } from '@/lib/api'
import { describeError } from '@/lib/errors'
import { formatTimestamp, shortId } from '@/lib/format'

const ALL = 'all'

export function JobsPage() {
  const [state, setState] = useState<JobState | typeof ALL>(ALL)
  const [page, setPage] = useState(1)
  const { data, error, loading } = useJobs({ page, state: state === ALL ? undefined : state })

  return (
    <>
      <PageHeader title="Jobs" />
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <QueueSummary />
        <Card>
          <CardHeader>
            <CardTitle>All jobs</CardTitle>
            <CardDescription>
              Newest first; filtered to queued, in the order they will run. Updates while any job on the page is
              unfinished.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Select
              value={state}
              onValueChange={(v) => {
                setState(v as JobState | typeof ALL)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All states</SelectItem>
                {JOB_STATES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {error && <p className="text-destructive text-sm">{describeError(error)}</p>}
            {loading && <Skeleton className="h-48 w-full" />}
            {data &&
              (data.total === 0 ? (
                <p className="text-muted-foreground text-sm">No jobs.</p>
              ) : (
                <>
                  <JobsTable jobs={data.items} />
                  <Pager page={data} onChange={setPage} />
                </>
              ))}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function QueueSummary() {
  const { data, error } = useJobSummary()

  if (error) return <p className="text-destructive text-sm">{describeError(error)}</p>
  if (!data) return <Skeleton className="h-24 w-full" />

  return (
    <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Queue</CardTitle>
          <CardDescription>One job runs at a time.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-4 gap-4">
          {JOB_STATES.map((s) => (
            <div key={s} className="flex flex-col gap-1">
              <span className="text-2xl font-semibold tabular-nums">{data.counts[s]}</span>
              <JobStateBadge state={s} />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Running and up next</CardTitle>
        </CardHeader>
        <CardContent>
          {data.running.length + data.next.length === 0 ? (
            <p className="text-muted-foreground text-sm">The queue is idle.</p>
          ) : (
            <JobsTable jobs={[...data.running, ...data.next]} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}


function JobsTable({ jobs }: { jobs: Job[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Job</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Video</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Attempts</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => {
          const videoId = videoIdOf(job.input)
          return (
            <TableRow key={job.id}>
              <TableCell className="font-mono text-xs">
                <Link to={`/jobs/${job.id}`} className="underline-offset-4 hover:underline">
                  {shortId(job.id)}
                </Link>
              </TableCell>
              <TableCell className="font-mono text-xs">{job.name}</TableCell>
              <TableCell className="font-mono text-xs">
                {videoId ? (
                  <Link to={`/videos/${videoId}`} className="underline-offset-4 hover:underline">
                    {shortId(videoId)}
                  </Link>
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell>
                <JobStateBadge state={job.state} />
              </TableCell>
              <TableCell>
                {job.attempts}/{job.maxAttempts}
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">{formatTimestamp(job.createdAt)}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

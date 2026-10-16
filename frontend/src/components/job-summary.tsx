import { Link } from 'react-router'
import { JobStateBadge } from '@/components/job-state-badge'
import { JsonView } from '@/components/json-view'
import type { Job } from '@/lib/api'
import { shortId } from '@/lib/format'

/** A job's state, with its output or error once it finishes. */
export function JobSummary({ job }: { job: Job }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/jobs/${job.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
          job {shortId(job.id)}
        </Link>
        <JobStateBadge state={job.state} />
        <span className="text-muted-foreground text-xs">
          attempt {job.attempts}/{job.maxAttempts}
        </span>
      </div>
      {job.error && <p className="text-destructive text-xs break-all">{job.error}</p>}
      {job.output != null && <JsonView value={job.output} />}
    </div>
  )
}

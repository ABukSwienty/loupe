import { Loader2Icon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { JobState } from '@/lib/api'

const VARIANTS: Record<JobState, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  queued: 'outline',
  processing: 'secondary',
  completed: 'default',
  failed: 'destructive',
}

export function JobStateBadge({ state }: { state: JobState }) {
  return (
    <Badge variant={VARIANTS[state]}>
      {state === 'processing' && <Loader2Icon className="animate-spin" />}
      {state}
    </Badge>
  )
}

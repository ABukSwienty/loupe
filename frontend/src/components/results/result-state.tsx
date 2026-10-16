import type { ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { isNotRun } from '@/lib/api'
import { describeError } from '@/lib/errors'

/** Loading, "not run yet" and error states for a result; renders children once there is data. */
export function ResultState<T>({
  result,
  step,
  children,
}: {
  result: { data: T | null; error: Error | null; loading: boolean }
  step: string
  children: (data: T) => ReactNode
}) {
  if (result.data) return children(result.data)
  if (result.loading) return <Skeleton className="h-48 w-full" />
  if (result.error && isNotRun(result.error)) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {step} hasn't run for this video yet. Queue it from the Run tab.
      </p>
    )
  }
  return <p className="text-destructive text-sm">{describeError(result.error)}</p>
}

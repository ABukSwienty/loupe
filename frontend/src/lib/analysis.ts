import { toast } from 'sonner'
import { ANALYSIS_STEPS, runAnalysisStep, type AnalysisStep } from '@/lib/api'
import { toastError } from '@/lib/errors'
import { invalidate } from '@/lib/refresh'

/** Queues one analysis step and reports the outcome in a toast; returns the job id. */
export async function queueStep(
  videoId: string,
  step: AnalysisStep,
  body: Record<string, unknown> = {},
): Promise<string | null> {
  const { title } = ANALYSIS_STEPS[step]
  try {
    const { status, data } = await runAnalysisStep(videoId, step, body)
    invalidate()
    if (status === 202) toast.success(`${title}: queued`)
    else toast.info(`${title}: already queued or running`, { description: 'The new parameters were ignored.' })
    return data.jobId
  } catch (err) {
    toastError(`${title} failed to queue`, err)
    return null
  }
}

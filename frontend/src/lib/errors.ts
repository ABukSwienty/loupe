import { toast } from 'sonner'
import { ApiError } from '@/lib/api'

export function describeError(err: unknown): string {
  if (err instanceof ApiError) return `${err.status}: ${err.message}`
  if (err instanceof TypeError) return `Couldn't reach the backend (${err.message})`
  return err instanceof Error ? err.message : String(err)
}

export function toastError(title: string, err: unknown) {
  toast.error(title, { description: describeError(err) })
}

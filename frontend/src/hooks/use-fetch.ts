import { useEffect, useState } from 'react'
import { useRefreshVersion } from '@/lib/refresh'

const POLL_MS = 1500

type State<T> = { fetcher: () => Promise<T>; data: T | null; error: Error | null }

/**
 * Runs `fetcher`, again on invalidate(), and every 1.5s while `pollWhile`
 * returns true. Memoize `fetcher` (and `pollWhile`): a new function is a new
 * request. Pass null to skip fetching.
 */
export function useFetch<T>(
  fetcher: (() => Promise<T>) | null,
  pollWhile?: (data: T) => boolean,
) {
  const [state, setState] = useState<State<T> | null>(null)
  const version = useRefreshVersion()

  useEffect(() => {
    if (!fetcher) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const data = await fetcher()
        if (cancelled) return
        setState({ fetcher, data, error: null })
        if (!pollWhile?.(data)) return
      } catch (err) {
        if (cancelled) return
        // Keep the last data for this request, so a blip doesn't blank the page.
        setState((s) => ({
          fetcher,
          data: s?.fetcher === fetcher ? s.data : null,
          error: err as Error,
        }))
        if (!pollWhile) return
      }
      timer = setTimeout(tick, POLL_MS)
    }
    void tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [fetcher, pollWhile, version])

  // Ignore a result left over from a previous request.
  const current = state?.fetcher === fetcher ? state : null
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: fetcher !== null && current === null,
  }
}

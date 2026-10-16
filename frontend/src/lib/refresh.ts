import { useSyncExternalStore } from 'react'

// A global "data changed" signal. Calling invalidate() makes every mounted
// useFetch refetch, e.g. so the sidebar picks up a new video after an ingest.

let version = 0
const listeners = new Set<() => void>()

export function invalidate() {
  version++
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useRefreshVersion(): number {
  return useSyncExternalStore(subscribe, () => version)
}

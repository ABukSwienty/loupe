/** Seconds as h:mm:ss or m:ss. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Unix milliseconds as a local date and time. */
export function formatTimestamp(ms: number | null | undefined): string {
  if (ms == null) return '—'
  return new Date(ms).toLocaleString()
}

export function shortId(id: string): string {
  return id.slice(0, 8)
}

/** Seconds as m:ss.s, for times that need more precision than formatDuration. */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(1).padStart(4, '0')
  return `${m}:${s}`
}

export function formatRange(start: number, end: number): string {
  return `${formatDuration(start)}–${formatDuration(end)}`
}

/** A link to the source at a time, for YouTube URLs; null otherwise. */
export function sourceUrlAt(sourceUrl: string | null, seconds: number): string | null {
  if (!sourceUrl) return null
  try {
    const url = new URL(sourceUrl)
    if (!url.hostname.endsWith('youtube.com')) return null
    url.searchParams.set('t', `${Math.floor(seconds)}s`)
    return url.toString()
  } catch {
    return null
  }
}

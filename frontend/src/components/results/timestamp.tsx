import { formatDuration, sourceUrlAt } from '@/lib/format'
import { usePlayerControls } from '@/lib/player'

const CLASS = 'text-muted-foreground hover:text-foreground font-mono text-xs tabular-nums underline-offset-4 hover:underline'

/** A time in the video. Seeks the player when there is one; otherwise links to the source at that time. */
export function Timestamp({ seconds, sourceUrl }: { seconds: number; sourceUrl: string | null }) {
  const { available, seek } = usePlayerControls()
  const label = formatDuration(seconds)
  if (available) {
    return (
      <button type="button" className={`${CLASS} w-fit cursor-pointer text-left`} onClick={() => seek(seconds)}>
        {label}
      </button>
    )
  }
  const href = sourceUrlAt(sourceUrl, seconds)
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={CLASS}>
      {label}
    </a>
  ) : (
    <span className="text-muted-foreground font-mono text-xs tabular-nums">{label}</span>
  )
}

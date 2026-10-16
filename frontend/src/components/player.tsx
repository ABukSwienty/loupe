import { FileVideoIcon } from 'lucide-react'
import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PlayerControlsContext, PlayerElementContext, PlayerTimeContext } from '@/lib/player'

export function PlayerProvider({ available, children }: { available: boolean; children: ReactNode }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [time, setTime] = useState(0)

  const controls = useMemo(
    () => ({
      available,
      seek: (seconds: number) => {
        const video = ref.current
        if (!video) return
        const t = Math.min(Math.max(0, seconds), video.duration || seconds)
        video.currentTime = t
        setTime(t) // before the seek finishes, so a scrubbed playhead keeps up
      },
    }),
    [available],
  )
  const element = useMemo(() => ({ ref, setTime }), [])

  return (
    <PlayerElementContext value={element}>
      <PlayerControlsContext value={controls}>
        <PlayerTimeContext value={time}>{children}</PlayerTimeContext>
      </PlayerControlsContext>
    </PlayerElementContext>
  )
}

/** The <video> for a PlayerProvider. Starts at `initialTime`, and seeks again when it changes. */
export function VideoPlayer({
  src,
  poster,
  initialTime,
}: {
  src: string | null
  poster?: string
  initialTime?: number
}) {
  const element = useContext(PlayerElementContext)
  const { seek } = useContext(PlayerControlsContext)

  // Before the metadata loads, this sets where playback will start.
  useEffect(() => {
    if (src && initialTime !== undefined) seek(initialTime)
  }, [src, initialTime, seek])

  if (!src) {
    return (
      <div className="bg-muted text-muted-foreground flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg text-sm">
        <FileVideoIcon className="size-6" />
        Not downloaded yet
      </div>
    )
  }

  const report = (e: { currentTarget: HTMLVideoElement }) => element?.setTime(e.currentTarget.currentTime)
  return (
    <video
      ref={element?.ref}
      src={src}
      poster={poster}
      controls
      playsInline
      preload="metadata"
      className="aspect-video w-full rounded-lg bg-black"
      onTimeUpdate={report}
      onSeeked={report}
    />
  )
}

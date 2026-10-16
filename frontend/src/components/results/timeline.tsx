import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { formatDuration } from '@/lib/format'
import { usePlayerControls, usePlayerTime } from '@/lib/player'
import { cn } from '@/lib/utils'

export type TimelineItem = { start: number; end: number; color: string; title: string }
export type TimelineLane = { key: string; label: ReactNode; items: TimelineItem[] }

const TICKS = [0, 0.25, 0.5, 0.75, 1]
const KEY_STEP = 5 // seconds per arrow key

/**
 * Lanes of time ranges with the player's playhead. Pressing an item seeks to
 * its start, pressing elsewhere seeks to that point, and dragging scrubs.
 */
export function Timeline({ duration, lanes, label }: { duration: number; lanes: TimelineLane[]; label: string }) {
  const { available, seek } = usePlayerControls()
  const time = usePlayerTime()
  const trackRef = useRef<HTMLDivElement>(null)
  const scrubbing = useRef(false)
  const [hover, setHover] = useState<number | null>(null)

  if (duration <= 0) return null
  const pct = (seconds: number) => `${(seconds / duration) * 100}%`
  const timeAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * duration
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!available || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    scrubbing.current = true
    const start = (e.target as HTMLElement).dataset.start
    seek(start !== undefined ? Number(start) : timeAt(e.clientX))
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const t = timeAt(e.clientX)
    setHover(t)
    if (scrubbing.current) seek(t)
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const next = { ArrowLeft: time - KEY_STEP, ArrowRight: time + KEY_STEP, Home: 0, End: duration }[e.key]
    if (next === undefined || !available) return
    e.preventDefault()
    seek(next)
  }

  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1">
      <div className="flex flex-col gap-2">
        {lanes.map((lane) => (
          <div key={lane.key} className="flex h-6 min-w-0 items-center">
            {lane.label}
          </div>
        ))}
      </div>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={available ? 0 : -1}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={time}
        aria-valuetext={formatDuration(time)}
        className={cn(
          'focus-visible:ring-ring relative flex touch-none flex-col gap-2 rounded select-none outline-none focus-visible:ring-2',
          available && 'cursor-pointer',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (scrubbing.current = false)}
        onPointerCancel={() => (scrubbing.current = false)}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
      >
        {lanes.map((lane) => (
          <div key={lane.key} className="bg-muted/50 relative h-6 rounded">
            {lane.items.map((item, i) => (
              <div
                key={i}
                data-start={item.start}
                title={item.title}
                className="hover:ring-foreground absolute inset-y-0 rounded-sm hover:ring-2"
                style={{
                  left: pct(item.start),
                  width: `max(2px, calc(${pct(item.end - item.start)} - 1px))`,
                  background: item.color,
                }}
              />
            ))}
          </div>
        ))}
        {hover !== null && (
          <div className="bg-foreground/40 pointer-events-none absolute inset-y-0 w-px" style={{ left: pct(hover) }} />
        )}
        {available && (
          <div
            className="bg-foreground ring-background pointer-events-none absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full ring-2"
            style={{ left: pct(time) }}
          />
        )}
      </div>
      <span />
      <div className="text-muted-foreground relative h-4 text-xs tabular-nums">
        {hover === null ? (
          TICKS.map((f) => (
            <span key={f} className="absolute" style={{ left: `${f * 100}%`, transform: `translateX(-${f * 100}%)` }}>
              {formatDuration(f * duration)}
            </span>
          ))
        ) : (
          <span
            className="text-foreground absolute -translate-x-1/2 font-medium"
            style={{ left: `clamp(1.5rem, ${pct(hover)}, calc(100% - 1.5rem))` }}
          >
            {formatDuration(hover)}
          </span>
        )}
      </div>
    </div>
  )
}

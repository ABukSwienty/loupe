import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ResultState } from '@/components/results/result-state'
import { SpeakerLabel } from '@/components/results/speaker-label'
import { Timestamp } from '@/components/results/timestamp'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useDiarization, useTranscription } from '@/hooks/use-api'
import { useScrollToHash } from '@/hooks/use-scroll-to-hash'
import type { Diarization, Transcription, TranscriptionSegment, Video } from '@/lib/api'
import { formatDuration, formatRange } from '@/lib/format'
import { usePlayerControls, usePlayerTime } from '@/lib/player'
import { speakerDuring } from '@/lib/speakers'
import { cn } from '@/lib/utils'

/** Words below this probability are underlined, to spot likely mistakes. */
const LOW_PROBABILITY = 0.5

export function TranscriptView({ video }: { video: Video }) {
  const transcription = useTranscription(video.id)
  // Optional: labels each segment with its speaker when diarization has run.
  const diarization = useDiarization(video.id)
  useScrollToHash(transcription.data !== null)

  return (
    <ResultState result={transcription} step="Transcription">
      {(t) => <Transcript transcription={t} diarization={diarization.data} sourceUrl={video.sourceUrl} />}
    </ResultState>
  )
}

function Transcript({
  transcription: t,
  diarization,
  sourceUrl,
}: {
  transcription: Transcription
  diarization: Diarization | null
  sourceUrl: string | null
}) {
  const [byChunk, setByChunk] = useState(false)
  const [follow, setFollow] = useState(false)
  const { available, seek } = usePlayerControls()
  const time = usePlayerTime()

  const lowWords = useMemo(
    () => t.segments.reduce((n, s) => n + s.words.filter((w) => w.probability < LOW_PROBABILITY).length, 0),
    [t],
  )
  const speakers = useMemo(
    () =>
      new Map(
        t.segments.map((s) => [
          s.index,
          diarization ? speakerDuring(diarization.exclusiveSegments, s.start, s.end) : null,
        ]),
      ),
    [t, diarization],
  )
  const active = available ? t.segments.find((s) => time >= s.start && time < s.end)?.index : undefined

  // Keep the playing segment in view when following.
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!follow || active === undefined) return
    container.current?.querySelector(`#seg-${active}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [follow, active])

  const row = (segment: TranscriptionSegment) => (
    <SegmentRow
      key={segment.index}
      segment={segment}
      speakers={diarization?.speakers ?? null}
      speaker={speakers.get(segment.index) ?? null}
      active={segment.index === active}
      seek={available ? seek : null}
      sourceUrl={sourceUrl}
    />
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span>
          <span className="text-muted-foreground">Language </span>
          {t.language} ({Math.round(t.languageProbability * 100)}%)
        </span>
        <span>
          <span className="text-muted-foreground">Duration </span>
          {formatDuration(t.duration)}
        </span>
        <span>
          <span className="text-muted-foreground">Segments </span>
          {t.segments.length}
        </span>
        <span>
          <span className="text-muted-foreground">Unsure words </span>
          {lowWords}
        </span>
        {!diarization && <span className="text-muted-foreground">Run diarize to see speakers.</span>}
        <div className="ml-auto flex flex-wrap items-center gap-4">
          {available && (
            <div className="flex items-center gap-2">
              <Switch id="follow" checked={follow} onCheckedChange={setFollow} />
              <Label htmlFor="follow">Follow playback</Label>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Switch id="by-chunk" checked={byChunk} onCheckedChange={setByChunk} />
            <Label htmlFor="by-chunk">Group by embedding chunk ({t.chunks?.length ?? 0})</Label>
          </div>
        </div>
      </div>

      <div ref={container}>
        {byChunk && t.chunks ? (
          <div className="flex flex-col gap-4">
            {t.chunks.map((chunk) => (
              <section key={chunk.id} className="rounded-lg border">
                <h3 className="text-muted-foreground border-b px-3 py-2 text-xs">
                  Chunk {chunk.index} · {formatRange(chunk.start, chunk.end)} · segments {chunk.startSegment}–
                  {chunk.endSegment}
                </h3>
                <div className="flex flex-col py-1">
                  {t.segments.filter((s) => s.index >= chunk.startSegment && s.index <= chunk.endSegment).map(row)}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="flex flex-col">{t.segments.map(row)}</div>
        )}
      </div>
    </div>
  )
}

/** Memoized: playback re-renders the transcript a few times a second, but only the active row changes. */
const SegmentRow = memo(function SegmentRow({
  segment,
  speakers,
  speaker,
  active,
  seek,
  sourceUrl,
}: {
  segment: TranscriptionSegment
  speakers: string[] | null
  speaker: string | null
  active: boolean
  seek: ((seconds: number) => void) | null
  sourceUrl: string | null
}) {
  return (
    <div
      id={`seg-${segment.index}`}
      onClick={() => {
        // Don't jump away while the user is selecting text to copy.
        if (seek && !window.getSelection()?.toString()) seek(segment.start)
      }}
      className={cn(
        'target:bg-accent grid grid-cols-[3.5rem_1fr] gap-x-3 rounded-md border-l-2 border-transparent px-3 py-1.5 sm:grid-cols-[3.5rem_7rem_1fr]',
        seek && 'hover:bg-accent/50 cursor-pointer',
        active && 'bg-accent border-foreground',
      )}
    >
      <Timestamp seconds={segment.start} sourceUrl={sourceUrl} />
      <span className="hidden sm:block">{speakers && speaker && <SpeakerLabel speakers={speakers} speaker={speaker} />}</span>
      <p className="text-sm leading-relaxed" title={`no speech ${Math.round(segment.noSpeechProb * 100)}%`}>
        {segment.words.length === 0
          ? segment.text
          : // Words come trimmed, so they're joined with spaces. Pressing one seeks to it.
            segment.words.map((w, i) => (
              <span key={i}>
                {i > 0 && ' '}
                <span
                  onClick={(e) => {
                    if (!seek || window.getSelection()?.toString()) return
                    e.stopPropagation()
                    seek(w.start)
                  }}
                  className={cn(
                    seek && 'hover:text-primary hover:underline',
                    w.probability < LOW_PROBABILITY &&
                      'decoration-muted-foreground underline decoration-dotted underline-offset-4',
                  )}
                  title={w.probability < LOW_PROBABILITY ? `${Math.round(w.probability * 100)}%` : undefined}
                >
                  {w.word.trim()}
                </span>
              </span>
            ))}
      </p>
    </div>
  )
})

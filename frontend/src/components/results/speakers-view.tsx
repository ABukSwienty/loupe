import { useState } from 'react'
import { ResultState } from '@/components/results/result-state'
import { SpeakerLabel } from '@/components/results/speaker-label'
import { Timeline } from '@/components/results/timeline'
import { Timestamp } from '@/components/results/timestamp'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useDiarization } from '@/hooks/use-api'
import type { Diarization, SpeakerTurn, Video } from '@/lib/api'
import { formatDuration, formatRange } from '@/lib/format'
import { speakerColor } from '@/lib/speakers'

export function SpeakersView({ video }: { video: Video }) {
  const diarization = useDiarization(video.id)
  return (
    <ResultState result={diarization} step="Diarization">
      {(d) => <Speakers diarization={d} duration={video.duration} sourceUrl={video.sourceUrl} />}
    </ResultState>
  )
}

function Speakers({
  diarization: d,
  duration,
  sourceUrl,
}: {
  diarization: Diarization
  duration: number | null
  sourceUrl: string | null
}) {
  const [overlapping, setOverlapping] = useState(false)
  const turns = overlapping ? d.segments : d.exclusiveSegments
  const total = duration ?? Math.max(0, ...turns.map((t) => t.end))
  const bySpeaker = new Map<string, SpeakerTurn[]>(d.speakers.map((s) => [s, []]))
  for (const t of turns) bySpeaker.get(t.speaker)?.push(t)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span>
          <span className="text-muted-foreground">Speakers </span>
          {d.speakers.length}
        </span>
        <span>
          <span className="text-muted-foreground">Turns </span>
          {turns.length}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Switch id="overlapping" checked={overlapping} onCheckedChange={setOverlapping} />
          <Label htmlFor="overlapping">Show overlapping speech</Label>
        </div>
      </div>

      {/* One lane per speaker, so position carries identity and colour only repeats it. */}
      <Timeline
        label="Speaker turns; press or drag to seek"
        duration={total}
        lanes={[...bySpeaker].map(([speaker, speakerTurns]) => ({
          key: speaker,
          label: <SpeakerLabel speakers={d.speakers} speaker={speaker} />,
          items: speakerTurns.map((t) => ({
            start: t.start,
            end: t.end,
            color: speakerColor(d.speakers, speaker),
            title: `${speaker} · ${formatRange(t.start, t.end)}`,
          })),
        }))}
      />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Speaker</TableHead>
            <TableHead className="text-right">Talk time</TableHead>
            <TableHead className="text-right">Share</TableHead>
            <TableHead className="text-right">Turns</TableHead>
            <TableHead className="text-right">First heard</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...bySpeaker].map(([speaker, speakerTurns]) => {
            const talk = speakerTurns.reduce((n, t) => n + t.end - t.start, 0)
            return (
              <TableRow key={speaker}>
                <TableCell>
                  <SpeakerLabel speakers={d.speakers} speaker={speaker} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatDuration(talk)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {total > 0 ? `${Math.round((talk / total) * 100)}%` : '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">{speakerTurns.length}</TableCell>
                <TableCell className="text-right">
                  {speakerTurns[0] ? <Timestamp seconds={speakerTurns[0].start} sourceUrl={sourceUrl} /> : '—'}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

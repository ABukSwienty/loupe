import type { SpeakerTurn } from '@/lib/api'

const SLOTS = 8

/** A speaker's colour by its position in the diarization's speaker list. Past 8, colours repeat. */
export function speakerColor(speakers: string[], speaker: string): string {
  const i = Math.max(0, speakers.indexOf(speaker))
  return `var(--speaker-${(i % SLOTS) + 1})`
}

/** The speaker who talks most during [start, end], from the exclusive turns. */
export function speakerDuring(turns: SpeakerTurn[], start: number, end: number): string | null {
  const overlap = new Map<string, number>()
  for (const t of turns) {
    if (t.end <= start) continue
    if (t.start >= end) break // turns are sorted by start
    const o = Math.min(end, t.end) - Math.max(start, t.start)
    overlap.set(t.speaker, (overlap.get(t.speaker) ?? 0) + o)
  }
  let best: string | null = null
  let bestOverlap = 0
  for (const [speaker, o] of overlap) {
    if (o > bestOverlap) [best, bestOverlap] = [speaker, o]
  }
  return best
}

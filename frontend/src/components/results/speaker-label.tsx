import { speakerColor } from '@/lib/speakers'

export function SpeakerLabel({ speakers, speaker }: { speakers: string[]; speaker: string }) {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
      <span className="size-2 shrink-0 rounded-full" style={{ background: speakerColor(speakers, speaker) }} />
      {speaker}
    </span>
  )
}

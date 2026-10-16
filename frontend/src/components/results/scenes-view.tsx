import { Keyframe } from '@/components/results/keyframe'
import { ResultState } from '@/components/results/result-state'
import { Timeline } from '@/components/results/timeline'
import { useOcr, useScenes } from '@/hooks/use-api'
import { useScrollToHash } from '@/hooks/use-scroll-to-hash'
import type { OcrLine, Video } from '@/lib/api'
import { formatRange } from '@/lib/format'
import { usePlayerControls, usePlayerTime } from '@/lib/player'
import { cn } from '@/lib/utils'

// Scenes have no identity to colour, so the strip alternates two tones to show the cuts.
const STRIP = ['color-mix(in oklch, var(--foreground) 45%, transparent)', 'color-mix(in oklch, var(--foreground) 25%, transparent)']

export function ScenesView({ video }: { video: Video }) {
  const detection = useScenes(video.id)
  // Optional: shows the text found in each keyframe when OCR has run.
  const ocr = useOcr(video.id)
  const { available, seek } = usePlayerControls()
  const time = usePlayerTime()
  useScrollToHash(detection.data !== null)

  const linesByScene = new Map<string, OcrLine[]>()
  for (const r of ocr.data ?? []) if (r.sceneId) linesByScene.set(r.sceneId, r.lines)

  return (
    <ResultState result={detection} step="Scene detection">
      {(d) => (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <span>
              <span className="text-muted-foreground">Scenes </span>
              {d.sceneCount}
            </span>
            <span>
              <span className="text-muted-foreground">Detector </span>
              {d.detector}, threshold {d.threshold ?? 'default'}
            </span>
            <span>
              <span className="text-muted-foreground">Frame rate </span>
              {d.fps.toFixed(2)} fps
            </span>
            {!ocr.data && <span className="text-muted-foreground">Run OCR to see the text in each keyframe.</span>}
          </div>
          <Timeline
            label="Scenes; press or drag to seek"
            duration={video.duration ?? d.duration}
            lanes={[
              {
                key: 'scenes',
                label: <span className="text-muted-foreground text-xs">Scenes</span>,
                items: d.scenes.map((scene, i) => ({
                  start: scene.start,
                  end: scene.end,
                  color: STRIP[i % 2],
                  title: `#${scene.index} · ${formatRange(scene.start, scene.end)}`,
                })),
              },
            ]}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
            {d.scenes.map((scene) => {
              const lines = linesByScene.get(scene.id)
              const current = available && time >= scene.start && time < scene.end
              return (
                <button
                  key={scene.id}
                  id={`scene-${scene.id}`}
                  type="button"
                  disabled={!available}
                  onClick={() => seek(scene.start)}
                  className={cn(
                    'bg-card target:ring-primary flex flex-col gap-2 rounded-lg border p-2 text-left target:ring-2 enabled:cursor-pointer enabled:hover:bg-accent',
                    current && 'ring-foreground ring-2',
                  )}
                >
                  <Keyframe url={scene.keyframeUrl} />
                  <div className="flex items-center gap-2 px-1 text-sm">
                    <span className="font-medium">#{scene.index}</span>
                    <span className="text-muted-foreground font-mono text-xs tabular-nums">
                      {formatRange(scene.start, scene.end)} · {(scene.end - scene.start).toFixed(1)}s
                    </span>
                    <span className="text-muted-foreground ml-auto font-mono text-xs">
                      f{scene.startFrame}–{scene.endFrame}
                    </span>
                  </div>
                  {lines && lines.length > 0 && (
                    <p className="text-muted-foreground line-clamp-3 px-1 text-xs" title={lines.map((l) => l.text).join('\n')}>
                      {lines.map((l) => l.text).join(' · ')}
                    </p>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </ResultState>
  )
}


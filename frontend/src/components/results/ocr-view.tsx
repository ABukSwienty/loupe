import { useState } from 'react'
import { Keyframe } from '@/components/results/keyframe'
import { ResultState } from '@/components/results/result-state'
import { Timestamp } from '@/components/results/timestamp'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useOcr, useScenes } from '@/hooks/use-api'
import type { Scene, Video } from '@/lib/api'

export function OcrView({ video }: { video: Video }) {
  const ocr = useOcr(video.id)
  // OCR runs on scene keyframes; the scenes give the images and times.
  const scenes = useScenes(video.id)
  const [onlyText, setOnlyText] = useState(true)
  const sceneById = new Map<string, Scene>((scenes.data?.scenes ?? []).map((s) => [s.id, s]))

  return (
    <ResultState result={ocr} step="OCR">
      {(results) => {
        const withText = results.filter((r) => r.lines.length > 0)
        const shown = onlyText ? withText : results
        return (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span>
                <span className="text-muted-foreground">Keyframes with text </span>
                {withText.length} of {results.length}
              </span>
              <span>
                <span className="text-muted-foreground">Lines </span>
                {results.reduce((n, r) => n + r.lines.length, 0)}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Switch id="only-text" checked={onlyText} onCheckedChange={setOnlyText} />
                <Label htmlFor="only-text">Only keyframes with text</Label>
              </div>
            </div>
            {shown.length === 0 && <p className="text-muted-foreground py-8 text-center text-sm">No text found.</p>}
            {shown.map((r) => {
              const scene = r.sceneId ? sceneById.get(r.sceneId) : undefined
              const time = r.time ?? scene?.keyframeTime ?? scene?.start
              return (
                <div key={r.id} className="grid gap-4 rounded-lg border p-3 md:grid-cols-[minmax(0,24rem)_1fr]">
                  <Keyframe url={scene?.keyframeUrl ?? null} lines={r.lines} />
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      {scene && <span className="font-medium">Scene #{scene.index}</span>}
                      {time != null && <Timestamp seconds={time} sourceUrl={video.sourceUrl} />}
                    </div>
                    {r.lines.length === 0 ? (
                      <p className="text-muted-foreground text-sm">No text.</p>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {r.lines.map((line, i) => (
                          <li key={i} className="flex items-baseline gap-3 text-sm">
                            <span className="text-muted-foreground w-9 shrink-0 text-right font-mono text-xs tabular-nums">
                              {Math.round(line.score * 100)}%
                            </span>
                            <span className="break-words">{line.text}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      }}
    </ResultState>
  )
}

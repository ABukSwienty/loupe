import { Loader2Icon, SearchIcon } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { PageHeader } from '@/components/page-header'
import { Keyframe } from '@/components/results/keyframe'
import { Timeline } from '@/components/results/timeline'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useSceneMatches, useVideos } from '@/hooks/use-api'
import { isNotRun, type SceneMatchResponse } from '@/lib/api'
import { describeError } from '@/lib/errors'
import { formatDuration, formatRange } from '@/lib/format'
import { cn } from '@/lib/utils'

// Cosine distance. SigLIP text-to-image distances sit in a narrow band: the
// closest scenes are around 0.86-0.92, and from 1.0 up nearly everything
// matches, so the slider covers only that part of the 0-2 range.
const DEFAULT_MAX = 0.9
const SLIDER_MIN = 0.85
const SLIDER_MAX = 1
// Each change re-embeds the query, so wait for the slider to settle.
const DEBOUNCE_MS = 250

const percent = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—')

function parseMax(value: string | null): number {
  const n = Number(value)
  return value !== null && value !== '' && n >= 0 && n <= 2 ? n : DEFAULT_MAX
}

/**
 * Searches one video's scene keyframes for a description, and shows what
 * share of its scenes are within a maximum cosine distance of it, or with
 * the inverse, further away. State is in the URL:
 * `?video=<id>&q=<text>&max=<0-2>&invert=1`.
 */
export function SceneMatchPage() {
  const [params, setParams] = useSearchParams()
  const videoId = params.get('video') ?? ''
  const q = params.get('q')?.trim() ?? ''
  const urlMax = parseMax(params.get('max'))
  const invert = params.get('invert') === '1'
  const videos = useVideos(1, 100).data?.items ?? []

  const [input, setInput] = useState(q)
  const [max, setMax] = useState(urlMax)

  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setParams(next, { replace: true })
  }

  // Write the slider to the URL once it settles; the search follows the URL.
  useEffect(() => {
    if (max === urlMax) return
    const timer = setTimeout(() => update({ max: String(max) }), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  })

  const result = useSceneMatches(videoId, videoId ? q : '', urlMax, invert)
  // Keep showing the previous result while the next one loads, so moving the
  // slider doesn't blank the page.
  const [last, setLast] = useState<SceneMatchResponse | null>(null)
  if (result.data && result.data !== last) setLast(result.data)
  const data = result.data ?? (last?.video.id === videoId ? last : null)
  const pending = result.loading || max !== urlMax

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    update({ q: input.trim() })
  }

  return (
    <>
      <PageHeader title="Scene match" />
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <form onSubmit={onSubmit} className="flex flex-col gap-2 md:flex-row">
          <Select value={videoId} onValueChange={(id) => update({ video: id })}>
            <SelectTrigger className="md:w-72">
              <SelectValue placeholder="Pick a video" />
            </SelectTrigger>
            <SelectContent>
              {videos.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  <span className="max-w-64 truncate">{v.title}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="What is shown, e.g. “a person in front of a map”"
            className="md:flex-1"
            autoFocus
          />
          <Button type="submit" disabled={!input.trim()}>
            {pending && videoId && q ? <Loader2Icon className="animate-spin" /> : <SearchIcon />}
            Search
          </Button>
        </form>
        <label className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground shrink-0">Max distance</span>
          <input
            type="range"
            min={SLIDER_MIN}
            max={SLIDER_MAX}
            step={0.001}
            value={max}
            onChange={(e) => setMax(Number(e.target.value))}
            className="accent-primary flex-1"
          />
          <span className="w-12 text-right font-mono tabular-nums">{max.toFixed(3)}</span>
        </label>
        <label className="flex w-fit items-center gap-3 text-sm">
          <Switch checked={invert} onCheckedChange={(on) => update({ invert: on ? '1' : '' })} />
          <span>Inverse</span>
          <span className="text-muted-foreground">show the scenes further away than the max distance</span>
        </label>

        {!videoId || !q ? (
          <p className="text-muted-foreground text-sm">
            Pick a video and describe what to look for. Scenes match when their keyframe is within the max cosine
            distance of the description; lower is stricter. Good SigLIP matches are usually around 0.86–0.92. The
            video needs scene detection and scene embeddings.
          </p>
        ) : result.error ? (
          <p className={cn('text-sm', isNotRun(result.error) ? 'text-muted-foreground' : 'text-destructive')}>
            {isNotRun(result.error)
              ? 'Scene detection hasn’t run for this video yet. Queue it from the video’s Run tab.'
              : describeError(result.error)}
          </p>
        ) : data ? (
          <Matches data={data} stale={pending} />
        ) : (
          <Skeleton className="h-64 w-full" />
        )}
      </div>
    </>
  )
}

function Matches({ data, stale }: { data: SceneMatchResponse; stale: boolean }) {
  const { video, scenes, duration, matches, invert } = data

  return (
    <div className={cn('flex flex-col gap-4 transition-opacity', stale && 'opacity-60')}>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
        <span>
          <span className="text-3xl font-semibold tabular-nums">{percent(scenes.matched, scenes.total)}</span>
          <span className="text-muted-foreground"> of scenes {invert ? 'don’t match' : 'match'}</span>
        </span>
        <span>
          {scenes.matched} <span className="text-muted-foreground">of</span> {scenes.total}{' '}
          <span className="text-muted-foreground">scenes</span>
        </span>
        <span>
          {formatDuration(duration.matched)} <span className="text-muted-foreground">of</span>{' '}
          {formatDuration(duration.total)}{' '}
          <span className="text-muted-foreground">({percent(duration.matched, duration.total)} of the time)</span>
        </span>
        {scenes.embedded < scenes.total && (
          <span className="text-muted-foreground">
            Only {scenes.embedded} of {scenes.total} scenes are embedded; the rest are in neither set.
          </span>
        )}
      </div>
      <Timeline
        label={invert ? 'Scenes that don’t match' : 'Matching scenes'}
        duration={duration.total}
        lanes={[
          {
            key: 'matches',
            label: <span className="text-muted-foreground text-xs">{invert ? 'No match' : 'Matches'}</span>,
            items: matches.map(({ scene, distance }) => ({
              start: scene.start,
              end: scene.end,
              color: 'var(--primary)',
              title: `#${scene.index} · ${formatRange(scene.start, scene.end)} · ${distance.toFixed(3)}`,
            })),
          },
        ]}
      />
      {matches.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          {invert
            ? 'Every embedded scene is within this distance. Lower the max to see more.'
            : 'No scenes within this distance. Raise the max to see more.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {matches.map(({ scene, distance }) => (
            <Link
              key={scene.id}
              to={`/videos/${video.id}?tab=scenes&t=${scene.start}#scene-${scene.id}`}
              className="bg-card hover:bg-accent flex flex-col gap-2 rounded-lg border p-2 transition-colors"
            >
              <Keyframe url={scene.keyframeUrl} />
              <div className="flex items-center gap-2 px-1 text-sm">
                <span className="font-medium">#{scene.index}</span>
                <span className="text-muted-foreground font-mono text-xs tabular-nums">
                  {formatRange(scene.start, scene.end)}
                </span>
                <span className="ml-auto font-mono text-xs tabular-nums" title="Cosine distance; lower is closer">
                  {distance.toFixed(3)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

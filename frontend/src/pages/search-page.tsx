import { Loader2Icon, SearchIcon } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { PageHeader } from '@/components/page-header'
import { Keyframe } from '@/components/results/keyframe'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useGroups, useSearch, useVideos } from '@/hooks/use-api'
import type { SceneHit, SearchQuery, SearchResponse, TranscriptHit } from '@/lib/api'
import { describeError } from '@/lib/errors'
import { formatRange } from '@/lib/format'

const ALL = 'all'
const K_OPTIONS = ['5', '10', '20', '50']

/** The scope select's value: "all", "video:<id>" or "group:<id>". */
function toQuery(params: URLSearchParams): SearchQuery | null {
  const q = params.get('q')?.trim()
  if (!q) return null
  const [kind, id] = (params.get('in') ?? ALL).split(':')
  return {
    q,
    k: Number(params.get('k') ?? 10),
    videoId: kind === 'video' ? id : undefined,
    groupId: kind === 'group' ? id : undefined,
  }
}

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const query = toQuery(params)
  const { transcripts, scenes } = useSearch(query)
  const [q, setQ] = useState(params.get('q') ?? '')
  const [k, setK] = useState(params.get('k') ?? '10')
  const [scope, setScope] = useState(params.get('in') ?? ALL)
  const videos = useVideos(1, 100).data?.items ?? []
  const groups = useGroups().data?.items ?? []

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!q.trim()) return
    setParams({ q: q.trim(), k, ...(scope === ALL ? {} : { in: scope }) })
  }

  return (
    <>
      <PageHeader title="Search" />
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <form onSubmit={onSubmit} className="flex flex-col gap-2 md:flex-row">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="What is said or shown, e.g. “a whiteboard with a diagram”"
            className="md:flex-1"
            autoFocus
          />
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="md:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All videos</SelectItem>
              {groups.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Groups</SelectLabel>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={`group:${g.id}`}>
                      {g.name} ({g.videoIds.length})
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {videos.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Videos</SelectLabel>
                  {videos.map((v) => (
                    <SelectItem key={v.id} value={`video:${v.id}`}>
                      <span className="max-w-56 truncate">{v.title}</span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
          <Select value={k} onValueChange={setK}>
            <SelectTrigger className="md:w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {K_OPTIONS.map((n) => (
                <SelectItem key={n} value={n}>
                  {n} hits
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" disabled={!q.trim()}>
            <SearchIcon />
            Search
          </Button>
        </form>

        {query ? (
          <div className="grid gap-6 xl:grid-cols-2">
            <HitsCard
              title="Said"
              description="Transcript chunks closest in meaning, from the bge-m3 text embeddings."
              result={transcripts}
            >
              {(r) => r.hits.map((hit) => <TranscriptHitRow key={hit.chunk.id} hit={hit} />)}
            </HitsCard>
            <HitsCard
              title="Shown"
              description="Scene keyframes matching the description, from the SigLIP image embeddings."
              result={scenes}
            >
              {(r) => (
                <div className="grid gap-3 sm:grid-cols-2">
                  {r.hits.map((hit) => (
                    <SceneHitCard key={hit.scene.id} hit={hit} />
                  ))}
                </div>
              )}
            </HitsCard>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Searches the transcript and scene embeddings at the same time. Videos need the embedding steps to show
            up here.
          </p>
        )}
      </div>
    </>
  )
}

function HitsCard<Hit>({
  title,
  description,
  result,
  children,
}: {
  title: string
  description: string
  result: { data: SearchResponse<Hit> | null; error: Error | null; loading: boolean }
  children: (response: SearchResponse<Hit>) => ReactNode
}) {
  const { data, error, loading } = result
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {title}
          {loading && <Loader2Icon className="text-muted-foreground size-4 animate-spin" />}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        {data && (
          <span className="text-muted-foreground font-mono text-xs">
            {data.hits.length} hits · {data.model}
          </span>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <p className="text-destructive text-sm">{describeError(error)}</p>}
        {loading && !data && <Skeleton className="h-40 w-full" />}
        {data && data.hits.length === 0 && <p className="text-muted-foreground text-sm">No hits.</p>}
        {data && data.hits.length > 0 && children(data)}
      </CardContent>
    </Card>
  )
}

/** Cosine distance, 0 (same) to 2 (opposite). */
function Distance({ value }: { value: number }) {
  return (
    <Badge variant="outline" className="font-mono tabular-nums" title="Cosine distance; lower is closer">
      {value.toFixed(3)}
    </Badge>
  )
}

function TranscriptHitRow({ hit }: { hit: TranscriptHit }) {
  const first = hit.segments[0]?.index
  const to = `/videos/${hit.video.id}?tab=transcript&t=${hit.chunk.start}${first === undefined ? '' : `#seg-${first}`}`
  return (
    <Link to={to} className="hover:bg-accent flex flex-col gap-1.5 rounded-lg border p-3 transition-colors">
      <div className="flex items-center gap-2 text-sm">
        <span className="min-w-0 truncate font-medium">{hit.video.title}</span>
        <span className="text-muted-foreground shrink-0 font-mono text-xs">
          {formatRange(hit.chunk.start, hit.chunk.end)}
        </span>
        <span className="ml-auto shrink-0">
          <Distance value={hit.distance} />
        </span>
      </div>
      <p className="text-muted-foreground line-clamp-4 text-sm">{hit.chunk.text}</p>
    </Link>
  )
}

function SceneHitCard({ hit }: { hit: SceneHit }) {
  return (
    <Link
      to={`/videos/${hit.video.id}?tab=scenes&t=${hit.scene.start}#scene-${hit.scene.id}`}
      className="hover:bg-accent flex flex-col gap-2 rounded-lg border p-2 transition-colors"
    >
      <Keyframe url={hit.scene.keyframeUrl} />
      <div className="flex items-center gap-2 px-1 text-sm">
        <span className="min-w-0 truncate font-medium" title={hit.video.title}>
          {hit.video.title}
        </span>
        <Distance value={hit.distance} />
      </div>
      <span className="text-muted-foreground px-1 font-mono text-xs">
        #{hit.scene.index} · {formatRange(hit.scene.start, hit.scene.end)}
      </span>
    </Link>
  )
}

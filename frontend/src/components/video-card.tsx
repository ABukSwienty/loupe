import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { thumbnailUrl, type Video } from '@/lib/api'
import { formatDuration, formatTimestamp } from '@/lib/format'

export function VideoCard({
  video,
  link = false,
  showThumbnail = true,
}: {
  video: Video
  link?: boolean
  showThumbnail?: boolean
}) {
  const thumb = showThumbnail ? thumbnailUrl(video) : null
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {link ? (
            <Link to={`/videos/${video.id}`} className="underline-offset-4 hover:underline">
              {video.title}
            </Link>
          ) : (
            video.title
          )}
        </CardTitle>
        <CardDescription>{video.channel ?? 'Unknown channel'}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row">
        {thumb && (
          <img src={thumb} alt="" className="aspect-video w-full rounded-md object-cover sm:w-56" />
        )}
        <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">ID</dt>
          <dd className="font-mono text-xs break-all">{video.id}</dd>
          <dt className="text-muted-foreground">Duration</dt>
          <dd>{formatDuration(video.duration)}</dd>
          <dt className="text-muted-foreground">Published</dt>
          <dd>{video.publishedAt ? new Date(video.publishedAt).toLocaleDateString() : '—'}</dd>
          <dt className="text-muted-foreground">Ingested</dt>
          <dd>{formatTimestamp(video.createdAt)}</dd>
          <dt className="text-muted-foreground">Source</dt>
          <dd className="break-all">
            {video.sourceUrl ? (
              <a href={video.sourceUrl} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                {video.sourceUrl}
              </a>
            ) : (
              '—'
            )}
          </dd>
          <dt className="text-muted-foreground">File</dt>
          <dd>
            {video.lowResPath ? (
              <span className="flex flex-col gap-1">
                <Badge className="w-fit">downloaded</Badge>
                <span className="text-muted-foreground font-mono text-xs break-all">{video.lowResPath}</span>
              </span>
            ) : (
              <Badge variant="outline">not downloaded</Badge>
            )}
          </dd>
        </dl>
      </CardContent>
    </Card>
  )
}

import { useState } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/page-header'
import { Pager } from '@/components/pager'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useVideos } from '@/hooks/use-api'
import { describeError } from '@/lib/errors'
import { formatDuration, formatTimestamp, shortId } from '@/lib/format'

export function VideosPage() {
  const [page, setPage] = useState(1)
  const { data, error, loading } = useVideos(page)

  return (
    <>
      <PageHeader title="Videos" />
      <div className="flex flex-col gap-6 p-4 md:p-6">
        {error && <p className="text-destructive text-sm">{describeError(error)}</p>}
        {loading && <Skeleton className="h-48 w-full" />}
        {data && (
          <Card>
            <CardContent className="flex flex-col gap-4">
              {data.total === 0 ? (
                <p className="text-muted-foreground text-sm">
                  None yet.{' '}
                  <Link to="/" className="underline underline-offset-4">
                    Ingest one
                  </Link>
                  .
                </p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead>Channel</TableHead>
                        <TableHead>ID</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>File</TableHead>
                        <TableHead>Ingested</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.items.map((v) => (
                        <TableRow key={v.id}>
                          <TableCell className="max-w-md truncate">
                            <Link to={`/videos/${v.id}`} className="font-medium underline-offset-4 hover:underline">
                              {v.title}
                            </Link>
                          </TableCell>
                          <TableCell className="max-w-48 truncate">{v.channel ?? '—'}</TableCell>
                          <TableCell className="font-mono text-xs">{shortId(v.id)}</TableCell>
                          <TableCell>{formatDuration(v.duration)}</TableCell>
                          <TableCell>
                            {v.lowResPath ? (
                              <Badge>downloaded</Badge>
                            ) : (
                              <Badge variant="outline">not downloaded</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            {formatTimestamp(v.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Pager page={data} onChange={setPage} />
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}

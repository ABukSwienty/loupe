import { ImageOffIcon } from 'lucide-react'
import { useState } from 'react'
import { apiUrl, type OcrLine } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * A scene keyframe, optionally with OCR boxes drawn over it. Boxes are in
 * pixels of the keyframe the OCR ran on, so the overlay uses its natural size.
 */
export function Keyframe({
  url,
  lines,
  className,
}: {
  url: string | null
  lines?: OcrLine[]
  className?: string
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [failed, setFailed] = useState(false)

  if (!url || failed) {
    return (
      <div className={cn('bg-muted text-muted-foreground flex aspect-video items-center justify-center rounded-md', className)}>
        <ImageOffIcon className="size-5" />
      </div>
    )
  }

  // The overlay sits in a box exactly the size of the image: the outer div can
  // be stretched by its parent (e.g. a grid row), which would offset the boxes.
  return (
    <div className={cn('self-start', className)}>
      <div className="relative overflow-hidden rounded-md">
        <img
          src={apiUrl(url)}
          alt=""
          loading="lazy"
          className="block w-full"
          onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onError={() => setFailed(true)}
        />
        {size && lines && lines.length > 0 && (
          <svg
            viewBox={`0 0 ${size.w} ${size.h}`}
            preserveAspectRatio="none"
            className="absolute inset-0 size-full"
            aria-hidden
          >
            {lines.map((line, i) => (
              <polygon
                key={i}
                points={line.box.map(([x, y]) => `${x},${y}`).join(' ')}
                className="fill-yellow-300/15 stroke-yellow-300"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              >
                <title>{line.text}</title>
              </polygon>
            ))}
          </svg>
        )}
      </div>
    </div>
  )
}

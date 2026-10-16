import { cn } from '@/lib/utils'

export function JsonView({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre
      className={cn(
        'bg-muted max-h-96 overflow-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap break-all',
        className,
      )}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

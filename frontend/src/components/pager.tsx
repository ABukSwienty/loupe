import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Page } from '@/lib/api'

export function Pager({ page, onChange }: { page: Page<unknown>; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(page.total / page.pageSize))
  return (
    <div className="flex items-center justify-end gap-2 text-sm">
      <span className="text-muted-foreground">
        {page.total} total · page {page.page} of {pages}
      </span>
      <Button variant="outline" size="icon-sm" disabled={page.page <= 1} onClick={() => onChange(page.page - 1)}>
        <ChevronLeftIcon />
      </Button>
      <Button variant="outline" size="icon-sm" disabled={page.page >= pages} onClick={() => onChange(page.page + 1)}>
        <ChevronRightIcon />
      </Button>
    </div>
  )
}

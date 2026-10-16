import { Link } from 'react-router'
import { PageHeader } from '@/components/page-header'

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Not found" />
      <p className="p-6 text-sm">
        No page here. <Link to="/" className="underline underline-offset-4">Go to ingest</Link>.
      </p>
    </>
  )
}

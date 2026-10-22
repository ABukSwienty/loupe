import { BrowserRouter, Outlet, Route, Routes } from 'react-router'
import { AppSidebar } from '@/components/app-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { IngestPage } from '@/pages/ingest-page'
import { JobPage } from '@/pages/job-page'
import { JobsPage } from '@/pages/jobs-page'
import { NotFoundPage } from '@/pages/not-found-page'
import { SceneMatchPage } from '@/pages/scene-match-page'
import { SearchPage } from '@/pages/search-page'
import { VideoPage } from '@/pages/video-page'
import { VideosPage } from '@/pages/videos-page'

function Layout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}

export default function App() {
  return (
    <TooltipProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<IngestPage />} />
            <Route path="videos" element={<VideosPage />} />
            <Route path="videos/:id" element={<VideoPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="scene-match" element={<SceneMatchPage />} />
            <Route path="jobs" element={<JobsPage />} />
            <Route path="jobs/:id" element={<JobPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster />
    </TooltipProvider>
  )
}

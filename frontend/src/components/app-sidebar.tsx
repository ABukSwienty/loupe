import { FilmIcon, ImagesIcon, ListChecksIcon, PlusIcon, ScanSearchIcon, SearchIcon } from 'lucide-react'
import { NavLink, useLocation } from 'react-router'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { ThemeToggle } from '@/components/theme-toggle'
import { useVideos } from '@/hooks/use-api'
import { API_URL } from '@/lib/api'

const NAV = [
  { to: '/', label: 'Ingest', icon: PlusIcon },
  { to: '/videos', label: 'Videos', icon: FilmIcon },
  { to: '/search', label: 'Search', icon: SearchIcon },
  { to: '/scene-match', label: 'Scene match', icon: ImagesIcon },
  { to: '/jobs', label: 'Jobs', icon: ListChecksIcon },
]

const RECENT_VIDEOS = 8

export function AppSidebar() {
  const { pathname } = useLocation()
  const videos = useVideos(1, RECENT_VIDEOS).data?.items ?? []

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <NavLink to="/">
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <ScanSearchIcon className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="font-semibold">loupe</span>
                  <span className="text-muted-foreground text-xs">video analysis</span>
                </div>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map(({ to, label, icon: Icon }) => (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton
                    asChild
                    tooltip={label}
                    isActive={to === '/' ? pathname === '/' : pathname === to}
                  >
                    <NavLink to={to}>
                      <Icon />
                      <span>{label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {videos.length > 0 && (
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Recent videos</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {videos.map((v) => (
                  <SidebarMenuItem key={v.id}>
                    <SidebarMenuButton asChild isActive={pathname === `/videos/${v.id}`}>
                      <NavLink to={`/videos/${v.id}`} title={v.title}>
                        <span>{v.title}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <ThemeToggle />
          </SidebarMenuItem>
        </SidebarMenu>
        <p className="text-muted-foreground px-2 font-mono text-xs break-all group-data-[collapsible=icon]:hidden">
          {API_URL}
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

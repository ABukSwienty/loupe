import { MoonIcon, SunIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { SidebarMenuButton } from '@/components/ui/sidebar'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme !== 'light'
  return (
    <SidebarMenuButton tooltip={dark ? 'Light mode' : 'Dark mode'} onClick={() => setTheme(dark ? 'light' : 'dark')}>
      {dark ? <SunIcon /> : <MoonIcon />}
      <span>{dark ? 'Light mode' : 'Dark mode'}</span>
    </SidebarMenuButton>
  )
}

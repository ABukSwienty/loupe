import { useEffect } from 'react'
import { useLocation } from 'react-router'

/**
 * Scrolls to the element named by the URL hash once `ready` is true. The
 * browser only does this itself if the element exists on navigation, and
 * results load later. Style the target with Tailwind's `target:` variant.
 */
export function useScrollToHash(ready: boolean) {
  const { hash } = useLocation()
  useEffect(() => {
    if (!ready || !hash) return
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'center' })
  }, [ready, hash])
}

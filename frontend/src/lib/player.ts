import { createContext, useContext, type RefObject } from 'react'

// The video page's player, shared so any result view can seek it. Controls and
// time are separate contexts: time changes several times a second, and only
// the components showing a playhead should re-render for it.

export type PlayerControls = {
  /** False until the video has a file to play. */
  available: boolean
  seek: (seconds: number) => void
}

export const PlayerControlsContext = createContext<PlayerControls>({ available: false, seek: () => {} })

export const PlayerTimeContext = createContext(0)

/** For VideoPlayer: the element to control and where to report its time. */
export const PlayerElementContext = createContext<{
  ref: RefObject<HTMLVideoElement | null>
  setTime: (seconds: number) => void
} | null>(null)

export function usePlayerControls(): PlayerControls {
  return useContext(PlayerControlsContext)
}

/** Seconds into the video; updates about four times a second while playing. */
export function usePlayerTime(): number {
  return useContext(PlayerTimeContext)
}

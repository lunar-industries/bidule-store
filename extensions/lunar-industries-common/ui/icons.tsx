/**
 * The icons the Lunar Industries modules share (the « Composants communs Lunar » maquette): drawn on a 24 px grid
 * with a 2 px stroke, in the text's colour, instead of « ⋯ », « › », « × » or « ▾ » written as text. Decorative
 * unless given a `label` (an icon alone in a button takes its name from the button's `aria-label`).
 */

const PATHS = {
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  up: 'M6 15l6-6 6 6',
  play: 'M8 5l11 7-11 7z',
  restart: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  sync: 'M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5',
  copy: 'M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3',
  search: 'M20 20l-4.5-4.5',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  send: 'M4 12l16-8-6 16-2.5-6.5z',
  paperclip: 'M20 11l-8 8a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7-7',
  terminal: 'M5 7l5 5-5 5M12 18h7',
  logs: 'M5 6h14M5 12h14M5 18h9',
  check: 'M5 12.5l4.5 4.5L19 7',
  slash: 'M15 4L9 20',
} as const

export type IconName = keyof typeof PATHS | 'more' | 'stop'
export const ICONS: IconName[] = [...(Object.keys(PATHS) as IconName[]), 'more', 'stop']

export function Icon({ name, size = 16, label }: { name: IconName; size?: number; label?: string }) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  if (name === 'more')
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...a11y}>
        <circle cx="5" cy="12" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="19" cy="12" r="1.8" />
      </svg>
    )
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...a11y}
    >
      {name === 'stop' && <rect x="6" y="6" width="12" height="12" rx="2" />}
      {name === 'copy' && <rect x="8" y="8" width="12" height="12" rx="2" />}
      {name === 'search' && <circle cx="11" cy="11" r="6" />}
      {name !== 'stop' && <path d={PATHS[name]} />}
    </svg>
  )
}

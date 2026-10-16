// Taken from quack-board's icons: 20 px (16 small), the text's colour.
const PATHS = {
  plus: 'M12 5v14M5 12h14',
  paperclip: 'M20 11.5 12.2 19.3a5 5 0 0 1-7.1-7.1L13 4.3a3.3 3.3 0 0 1 4.7 4.7l-7.8 7.8a1.7 1.7 0 0 1-2.4-2.4L14.6 7.3',
  slash: 'M15 4 9 20',
  send: 'M5 12h13M12 5l7 7-7 7',
  stop: 'M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
  left: 'm15 6-6 6 6 6',
  right: 'm9 6 6 6-6 6',
  close: 'M6 6l12 12M18 6 6 18',
  // « ⋯ »: three round dots, drawn thicker than the lines.
  more: 'M5 12h.01M12 12h.01M19 12h.01',
}
const THICK: Partial<Record<keyof typeof PATHS, number>> = { more: 3.5 }
export type IconName = keyof typeof PATHS

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth={THICK[name] ?? 2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

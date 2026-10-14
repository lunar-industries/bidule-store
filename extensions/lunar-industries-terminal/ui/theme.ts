import type { ITheme } from 'ghostty-web'

// The sixteen ANSI colours, readable on the theme's panel: bright on the dark themes, deeper on the light ones.
const DARK_ANSI: ITheme = {
  black: '#3b3346', red: '#ff7a7a', green: '#8fd694', yellow: '#f2cd72', blue: '#82aaff', magenta: '#d69bf2', cyan: '#7fd6d0', white: '#d9d0e3',
  brightBlack: '#6f6480', brightRed: '#ff9e9e', brightGreen: '#aee8b2', brightYellow: '#ffe19a', brightBlue: '#a8c4ff', brightMagenta: '#e6b9ff', brightCyan: '#a3ebe6', brightWhite: '#ffffff',
}
const LIGHT_ANSI: ITheme = {
  black: '#241b35', red: '#c4312f', green: '#2f7d32', yellow: '#9a6700', blue: '#2451b5', magenta: '#8e3fa8', cyan: '#127a78', white: '#8a8196',
  brightBlack: '#5a4e6a', brightRed: '#d9534f', brightGreen: '#3f9a43', brightYellow: '#b58100', brightBlue: '#3b6fd6', brightMagenta: '#a85cc2', brightCyan: '#1b9693', brightWhite: '#b5acc0',
}

// A colour of the theme as #rrggbb: ghostty-web reads only #rgb, #rrggbb and rgb(…) (anything else would be black).
function hex(color: string, fallback: string): string {
  const c = color.trim()
  if (/^#[0-9a-f]{6}$/i.test(c)) return c
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${c.slice(1).split('').map((d) => d + d).join('')}`
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(c)
  if (rgb) return `#${rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`
  return fallback
}

// Perceived lightness of a #rrggbb colour, 0 to 1.
function lightness(color: string): number {
  const n = Number.parseInt(color.slice(1), 16)
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
}

/**
 * The terminal's colours, read from the app's theme (the variables of the body's theme class): its panel, its text,
 * the coral of its cursor. A new terminal takes them when it is made; ghostty-web keeps them for its life (it gives
 * its cells their colours as they are written), so a theme chosen later shows in the tabs opened after.
 */
export function themeNow(el: Element = document.body): ITheme {
  const style = getComputedStyle(el)
  const v = (name: string, fallback: string) => hex(style.getPropertyValue(name), fallback)
  const background = v('--card', '#241d30')
  const coral = v('--coral', '#ff8a6b')
  return {
    ...(lightness(background) > 0.5 ? LIGHT_ANSI : DARK_ANSI),
    background,
    foreground: v('--text', '#ede6f5'),
    cursor: coral,
    cursorAccent: background,
    selectionBackground: coral,
    selectionForeground: background,
  }
}

// What ghostty-web 0.4.0 sends wrong for a few keys, sent here instead (tabs.ts takes the key before it). Pure.
//
// - Shift with Tab, Home, End, Delete or F1–F12: ghostty-web reads Shift as no modifier there, so Shift+Tab sent a plain
//   tab (Claude Code changes its mode with the back tab, ESC [ Z). Fixed in ghostty-web's main, not in 0.4.0
//   (coder/ghostty-web#109, #137). The sequences are xterm's, as the official terminal (xterm.js) sends them.
// - Alt with a character (Alt+b, Alt+Enter, Alt+Backspace): ghostty-web sends it without the ESC prefix that says Alt,
//   so readline, emacs, tmux and Claude Code lose their Alt bindings (coder/ghostty-web#203). Not on macOS, where
//   Option types characters (@, |, ~ on some layouts) and the official terminal leaves it so too.

export type KeyLike = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>

// xterm's sequences with Shift (modifier 2).
const SHIFTED: Record<string, string> = {
  Tab: '\x1b[Z',
  Home: '\x1b[1;2H',
  End: '\x1b[1;2F',
  Delete: '\x1b[3;2~',
  F1: '\x1b[1;2P',
  F2: '\x1b[1;2Q',
  F3: '\x1b[1;2R',
  F4: '\x1b[1;2S',
  F5: '\x1b[15;2~',
  F6: '\x1b[17;2~',
  F7: '\x1b[18;2~',
  F8: '\x1b[19;2~',
  F9: '\x1b[20;2~',
  F10: '\x1b[21;2~',
  F11: '\x1b[23;2~',
  F12: '\x1b[24;2~',
}

// With Alt: a key that is not a character but has one to prefix.
const ALT_KEYS: Record<string, string> = { Enter: '\r', Backspace: '\x7f', Escape: '\x1b' }

/**
 * The sequence to send for this key in place of ghostty-web's, or null to leave the key to it. `mac`: on macOS, Alt is
 * left alone. Ctrl or Cmd with the key: left alone (ghostty-web's encoder, or the app's shortcuts, take it).
 */
export function keySequence(e: KeyLike, mac: boolean): string | null {
  if (e.ctrlKey || e.metaKey) return null
  if (e.shiftKey && !e.altKey) return SHIFTED[e.key] ?? null
  if (e.altKey && !mac) {
    if (e.key.length === 1) return `\x1b${e.key}`
    const key = ALT_KEYS[e.key]
    return key === undefined ? null : `\x1b${key}`
  }
  return null
}

// Shift+Page Up / Page Down scroll the scrollback by a page, as in the official terminal (ghostty-web sent them to the
// shell as plain Page Up / Page Down): -1 up, 1 down, null for any other key.
export function pageScroll(e: KeyLike): -1 | 1 | null {
  if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return null
  return e.key === 'PageUp' ? -1 : e.key === 'PageDown' ? 1 : null
}

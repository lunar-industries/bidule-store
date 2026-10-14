import { describe, expect, it } from 'vitest'
import { keySequence, pageScroll, type KeyLike } from './keys.ts'

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
})

describe('Terminal (Lunar Industries) · keys ghostty-web sends wrong', () => {
  it('sends the back tab for Shift+Tab, and xterm’s sequences for the other shifted keys', () => {
    expect(keySequence(key('Tab', { shiftKey: true }), false)).toBe('\x1b[Z')
    expect(keySequence(key('Home', { shiftKey: true }), false)).toBe('\x1b[1;2H')
    expect(keySequence(key('F5', { shiftKey: true }), false)).toBe('\x1b[15;2~')
    // On macOS too: Shift is no character key.
    expect(keySequence(key('Tab', { shiftKey: true }), true)).toBe('\x1b[Z')
  })

  it('prefixes a character typed with Alt by ESC, Enter and Backspace too', () => {
    expect(keySequence(key('b', { altKey: true }), false)).toBe('\x1bb')
    expect(keySequence(key('P', { altKey: true, shiftKey: true }), false)).toBe('\x1bP')
    expect(keySequence(key('Enter', { altKey: true }), false)).toBe('\x1b\r')
    expect(keySequence(key('Backspace', { altKey: true }), false)).toBe('\x1b\x7f')
  })

  it('leaves the rest to ghostty-web: plain keys, Ctrl, AltGr (Ctrl+Alt), Cmd, and Alt on macOS', () => {
    expect(keySequence(key('Tab'), false)).toBeNull()
    expect(keySequence(key('a', { shiftKey: true }), false)).toBeNull()
    expect(keySequence(key('Tab', { shiftKey: true, ctrlKey: true }), false)).toBeNull()
    expect(keySequence(key('@', { altKey: true, ctrlKey: true }), false)).toBeNull()
    expect(keySequence(key('b', { altKey: true }), true)).toBeNull()
    expect(keySequence(key('ArrowLeft', { altKey: true }), false)).toBeNull()
  })

  it('scrolls a page with Shift+Page Up or Down', () => {
    expect(pageScroll(key('PageUp', { shiftKey: true }))).toBe(-1)
    expect(pageScroll(key('PageDown', { shiftKey: true }))).toBe(1)
    expect(pageScroll(key('PageUp'))).toBeNull()
    expect(pageScroll(key('PageUp', { shiftKey: true, ctrlKey: true }))).toBeNull()
  })
})

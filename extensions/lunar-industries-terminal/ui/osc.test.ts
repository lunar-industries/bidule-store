import { describe, expect, it } from 'vitest'
import { notificationOf, OSC_MAX, OscReader } from './osc.ts'

const ESC = '\x1b'
const BEL = '\x07'
const ST = `${ESC}\\`

describe('Terminal (Lunar Industries) · OSC in the output', () => {
  it('reads a sequence ended by BEL or by ST, with its code and data', () => {
    const reader = new OscReader()
    expect(reader.read(`a${ESC}]133;C${BEL}b${ESC}]7;file://host/home/me${ST}c`)).toEqual([
      { code: 133, data: 'C' },
      { code: 7, data: 'file://host/home/me' },
    ])
  })

  it('keeps the data whole, semicolons included', () => {
    expect(new OscReader().read(`${ESC}]633;E;git commit -m a\\x3bb${BEL}`)).toEqual([{ code: 633, data: 'E;git commit -m a\\x3bb' }])
  })

  it('finds a sequence cut anywhere between two chunks', () => {
    const whole = `ls${ESC}]133;D;1${ST}$ `
    for (let cut = 0; cut <= whole.length; cut++) {
      const reader = new OscReader()
      expect([...reader.read(whole.slice(0, cut)), ...reader.read(whole.slice(cut))], `cut at ${cut}`).toEqual([{ code: 133, data: 'D;1' }])
    }
  })

  it('reads a sequence that comes in many small chunks', () => {
    const reader = new OscReader()
    const found = [...`${ESC}]133;A${BEL}`].flatMap((c) => reader.read(c))
    expect(found).toEqual([{ code: 133, data: 'A' }])
  })

  it('drops a sequence cut short by another escape, and reads the one after', () => {
    expect(new OscReader().read(`${ESC}]133;C${ESC}[0m${ESC}]133;D${BEL}`)).toEqual([{ code: 133, data: 'D' }])
  })

  it('ignores what has no numeric code, and what is not an OSC', () => {
    expect(new OscReader().read(`${ESC}]abc;x${BEL}${ESC}[31mred${ESC}[0m`)).toEqual([])
  })

  it('does not keep a sequence that never ends beyond its limit', () => {
    const reader = new OscReader()
    expect(reader.read(`${ESC}]52;c;${'x'.repeat(OSC_MAX)}`)).toEqual([])
    expect(reader.read(`${BEL}${ESC}]133;A${BEL}`)).toEqual([{ code: 133, data: 'A' }])
  })

  it('a desktop notification, from iTerm2’s, Ghostty’s or Kitty’s sequence, and nothing else', () => {
    const [iterm] = new OscReader().read(`${ESC}]9;Claude needs your permission${BEL}`)
    expect(notificationOf(iterm)).toBe('Claude needs your permission')
    expect(notificationOf({ code: 9, data: '4;1;50' })).toBeNull()
    expect(notificationOf({ code: 9, data: '9;/home/simon' })).toBeNull()
    expect(notificationOf({ code: 777, data: 'notify;Claude Code;Claude is waiting for your input' })).toBe(
      'Claude Code — Claude is waiting for your input',
    )
    expect(notificationOf({ code: 777, data: 'preexec' })).toBeNull()
    expect(notificationOf({ code: 99, data: 'i=1:d=0;Claude is waiting' })).toBe('Claude is waiting')
    expect(notificationOf({ code: 133, data: 'A' })).toBeNull()
  })
})

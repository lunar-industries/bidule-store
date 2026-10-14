import { describe, expect, it } from 'vitest'
import { CommandTracker, commandLineOf, durationText, folderOf, noticeOf } from './integration.ts'

describe('Terminal (Lunar Industries) · the shell integration marks', () => {
  it('reads the command line with its escapes undone', () => {
    expect(commandLineOf('E;echo "a\\x3bb\\\\\\\\c"')).toBe('echo "a;b\\\\c"')
    expect(commandLineOf('P;Cwd=/tmp')).toBeNull()
  })

  it('reads the folder of OSC 7, its % escaped', () => {
    expect(folderOf('file://host/var/home/teddy/my%25dir')).toBe('/var/home/teddy/my%dir')
    expect(folderOf('file:///tmp')).toBe('/tmp')
    expect(folderOf('nonsense')).toBeNull()
  })

  it('tracks a command from its start to its end, its marks coming twice (Fedora adds its own)', () => {
    const t = new CommandTracker()
    t.mark('A', 0)
    expect(t.mark('C', 1000)).toBeNull() // the system's own C, before the line
    t.line('npm test')
    expect(t.mark('C', 1010)).toBeNull() // ours
    expect(t.mark('D;1', 61_000)).toEqual({ command: 'npm test', code: 1, ms: 60_000 })
    expect(t.mark('D;1', 61_001)).toBeNull() // the second D: nothing more
    t.mark('A', 61_002)
    expect(t.running).toBe(false)
  })

  it('a prompt without an end mark ends the command without a code; an empty line makes no command', () => {
    const t = new CommandTracker()
    t.line('sleep 99')
    t.mark('C', 0)
    expect(t.mark('A', 5000)).toEqual({ command: 'sleep 99', code: null, ms: 5000 })
    expect(t.mark('D;0', 6000)).toBeNull()
  })

  it('says how long it took and how it ended', () => {
    expect(durationText(42_000)).toBe('42 s')
    expect(durationText(185_000)).toBe('3 min 05')
    expect(durationText(3_720_000)).toBe('1 h 02')
    expect(noticeOf({ command: 'npm test', code: 2, ms: 45_000 })).toEqual({
      ok: false,
      title: 'Commande en échec',
      body: 'npm test — 45 s · code 2',
    })
    expect(noticeOf({ command: null, code: 0, ms: 31_000 }).body).toBe('La commande — 31 s')
  })
})

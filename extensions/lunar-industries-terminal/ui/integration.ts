// What a shell with integration writes around its commands (core/desktop/src/shell-scripts.ts), read by the tabs: OSC 133
// (A: a prompt, C: a command starts, D;code: it ended), OSC 633;E (the command line), OSC 7 (the current folder). Some
// systems add their own marks too (Fedora's VTE scripts write OSC 133 and OSC 7): they may come twice, in any order. Pure.

// A command ends after this long: told when it ends out of sight (another tab, the window in the background).
export const LONG_COMMAND_MS = 30_000

export type Finished = { command: string | null; code: number | null; ms: number }

// The command line of OSC 633;E, its escapes undone (`\\` a backslash, `\xHH` a byte).
export function commandLineOf(data: string): string | null {
  if (!data.startsWith('E;')) return null
  return data.slice(2).replace(/\\(\\|x([0-9a-fA-F]{2}))/g, (_m, all: string, hex?: string) =>
    hex ? String.fromCharCode(parseInt(hex, 16)) : all,
  )
}

// The folder of OSC 7 (`file://host/path`, its `%` escaped): the path, decoded; null for anything else. Without a host,
// a Windows folder (PowerShell's integration writes them): a drive's (`file:///C:/Users`) or a share's
// (`file:////wsl.localhost/Debian/home`), given back with its backslashes.
export function folderOf(data: string): string | null {
  const m = /^file:\/\/([^/]*)(\/.*)$/.exec(data.trim())
  if (!m) return null
  let path: string
  try {
    path = decodeURIComponent(m[2])
  } catch {
    path = m[2]
  }
  if (m[1] === '' && /^\/[A-Za-z]:(\/|$)/.test(path)) return `${path.slice(1, 3)}\\${path.slice(4).replace(/\//g, '\\')}`
  if (m[1] === '' && path.startsWith('//')) return path.replace(/\//g, '\\')
  return path
}

/**
 * One tab's commands, from its marks: when one starts (the first C after a prompt), its line (633;E, before or after
 * its C), its end (the first D; a prompt without one ends it without a code). `mark` returns the command that just
 * ended, once.
 */
export class CommandTracker {
  #running = false
  #start = 0
  #command: string | null = null
  #pending: string | null = null

  get running(): boolean {
    return this.#running
  }

  // The line of the command running, when the shell said it (null otherwise, or when none runs).
  get command(): string | null {
    return this.#running ? this.#command : null
  }

  line(command: string): void {
    if (this.#running && this.#command === null) this.#command = command
    else this.#pending = command
  }

  mark(data: string, now: number): Finished | null {
    const [kind, code] = data.split(';')
    if (kind === 'C') {
      if (!this.#running) {
        this.#running = true
        this.#start = now
        this.#command = this.#pending
        this.#pending = null
      } else if (this.#command === null && this.#pending !== null) {
        this.#command = this.#pending
        this.#pending = null
      }
      return null
    }
    if ((kind === 'D' || kind === 'A') && this.#running) {
      this.#running = false
      const parsed = kind === 'D' && code !== undefined && /^-?\d+$/.test(code) ? Number(code) : null
      const done: Finished = { command: this.#command, code: parsed, ms: now - this.#start }
      this.#command = null
      return done
    }
    return null
  }
}

// « 42 s », « 3 min 05 », « 1 h 02 ».
export function durationText(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')}`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

// What the notification of a command ended out of sight says.
export function noticeOf(done: Finished): { ok: boolean; title: string; body: string } {
  const ok = done.code === null || done.code === 0
  const what = done.command?.trim() || 'La commande'
  const code = ok ? '' : ` · code ${done.code}`
  return { ok, title: ok ? 'Commande terminée' : 'Commande en échec', body: `${what} — ${durationText(done.ms)}${code}` }
}

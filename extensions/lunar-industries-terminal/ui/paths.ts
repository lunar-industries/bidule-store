// A file dropped on the terminal: its path written at the prompt, quoted for the shell the tab runs. Pure.

// What the tab's shell takes: a POSIX shell (Linux, macOS, WSL), PowerShell.
export type ShellKind = 'posix' | 'wsl' | 'powershell'

// Quoted only when needed: a plain path stays as it is.
export const posixQuote = (path: string) => (/^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`)
export const powershellQuote = (path: string) => (/^[\w@%+=:,.\\/-]+$/.test(path) ? path : `'${path.replace(/'/g, "''")}'`)

/**
 * A Windows path as WSL sees it: a folder of a distro (`\\wsl$\Ubuntu\home\me`, `\\wsl.localhost\…`) by its Linux
 * path, a drive (`C:\Users`) under /mnt; anything else as it is.
 */
export function toWsl(path: string): string {
  const distro = /^\\\\wsl(?:\$|\.localhost)\\[^\\]+(\\.*)?$/i.exec(path)
  if (distro) return (distro[1] ?? '\\').replace(/\\/g, '/')
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(path)
  if (drive) return `/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, '/')}`
  return path
}

// A `file://` URI (what file managers give a drop) as a path of this machine.
export function uriToPath(uri: string): string | null {
  let url: URL
  try {
    url = new URL(uri.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'file:') return null
  const path = decodeURIComponent(url.pathname)
  // A Windows drive: /C:/Users → C:\Users; a share of another host: \\host\path.
  if (/^\/[A-Za-z]:\//.test(path)) return path.slice(1).replace(/\//g, '\\')
  if (url.host && url.host !== 'localhost') return `\\\\${url.host}${path.replace(/\//g, '\\')}`
  return path
}

// The paths of a `text/uri-list` (one per line, `#` lines are comments).
export const pathsOfUriList = (list: string) =>
  list
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map(uriToPath)
    .filter((p): p is string => p !== null)

// What is typed at the prompt for these paths: each quoted, separated and followed by a space.
export function dropText(paths: string[], shell: ShellKind): string {
  const quoted = paths.map((p) => (shell === 'powershell' ? powershellQuote(p) : posixQuote(shell === 'wsl' ? toWsl(p) : p)))
  return quoted.length ? `${quoted.join(' ')} ` : ''
}

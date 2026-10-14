import { describe, expect, it } from 'vitest'
import { dropText, pathsOfUriList, posixQuote, powershellQuote, toWsl, uriToPath } from './paths.ts'

describe('Terminal (Lunar Industries) · a file dropped on the terminal', () => {
  it('quotes a path only when the shell needs it', () => {
    expect(posixQuote('/home/me/notes.md')).toBe('/home/me/notes.md')
    expect(posixQuote("/home/me/l'été 2026.md")).toBe(`'/home/me/l'\\''été 2026.md'`)
    expect(powershellQuote('C:\\Users\\me\\a.txt')).toBe('C:\\Users\\me\\a.txt')
    expect(powershellQuote("C:\\Mes documents\\l'an.txt")).toBe("'C:\\Mes documents\\l''an.txt'")
  })

  it('gives WSL its own paths: a distro folder by its Linux path, a drive under /mnt', () => {
    expect(toWsl('\\\\wsl$\\Ubuntu\\home\\me\\a.ts')).toBe('/home/me/a.ts')
    expect(toWsl('\\\\wsl.localhost\\Debian')).toBe('/')
    expect(toWsl('D:\\Projets\\app')).toBe('/mnt/d/Projets/app')
    expect(toWsl('/home/me')).toBe('/home/me')
  })

  it("reads the file managers' URIs", () => {
    expect(uriToPath('file:///home/me/mon%20fichier.txt')).toBe('/home/me/mon fichier.txt')
    expect(uriToPath('file:///C:/Users/me/a.txt')).toBe('C:\\Users\\me\\a.txt')
    expect(uriToPath('https://example.com')).toBeNull()
    expect(pathsOfUriList('# comment\r\nfile:///a/b\r\nfile:///c%20d\r\n')).toEqual(['/a/b', '/c d'])
  })

  it('types the paths for the shell, followed by a space', () => {
    expect(dropText(['/a/b', '/c d'], 'posix')).toBe("/a/b '/c d' ")
    expect(dropText(['C:\\x y\\z.txt'], 'wsl')).toBe("'/mnt/c/x y/z.txt' ")
    expect(dropText(['C:\\x y\\z.txt'], 'powershell')).toBe("'C:\\x y\\z.txt' ")
    expect(dropText([], 'posix')).toBe('')
  })
})

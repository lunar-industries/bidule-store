import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

// Where Claude Code keeps a session's transcript: `<config>/projects/<project folder>/<id>.jsonl`. The project folder is
// named after the session's folder, each character but letters and digits turned into `-` (long ones are cut and given
// a hash). That rule is Claude Code's and may change: it is only tried first, and the projects are looked through when
// it misses.
export const projectFolderName = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-')

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false
  )

// The folder holding a session's transcript, as this process reaches it (`configDir`: Claude Code's folder there);
// null when no project has it, or when `id` is no session id (it names a file).
export async function transcriptFolder(configDir: string, cwd: string | undefined, id: string): Promise<string | null> {
  if (!/^[\w-]+$/.test(id)) return null
  const projects = join(configDir, 'projects')
  const file = `${id}.jsonl`
  if (cwd) {
    const named = join(projects, projectFolderName(cwd))
    if (await exists(join(named, file))) return named
  }
  const folders = await readdir(projects, { withFileTypes: true }).catch(() => [])
  for (const folder of folders) {
    if (folder.isDirectory() && (await exists(join(projects, folder.name, file)))) return join(projects, folder.name)
  }
  return null
}

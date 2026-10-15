import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The containers ticked (`engine:project/service`, or `engine:name` outside a project: they outlive a container
 * recreated with a new id), kept in the extension's data: coming back, even after the app was closed, the
 * user finds them ticked. The only thing this module keeps of its own; the containers are docker's.
 */
export class Selection {
  constructor(
    // The extension's folder in the app's data.
    protected dataDir: () => Promise<string>
  ) {}

  async keys(): Promise<string[]> {
    const file = join(await this.dataDir(), 'selection.json')
    if (!existsSync(file)) return []
    try {
      const keys: unknown = JSON.parse(await readFile(file, 'utf8'))
      return Array.isArray(keys) ? keys.filter((k) => typeof k === 'string') : []
    } catch {
      return []
    }
  }

  async save(keys: string[]): Promise<void> {
    const file = join(await this.dataDir(), 'selection.json')
    await writeFile(`${file}.tmp`, JSON.stringify(keys))
    await rename(`${file}.tmp`, file)
  }
}

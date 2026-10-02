import { describe, expect, it } from 'vitest'
import { SessionService } from '../server/sessions.ts'
import type { SessionStore } from '../server/store.ts'
import { FakeGit, settingsWith } from './fakes.ts'

// Where a session may run: the workspace's root, a repo the app knows or a folder in one, never any other.
const service = (root = '/home/simon/code') =>
  new SessionService({
    store: {} as unknown as SessionStore,
    settings: async () => settingsWith({ root }),
    git: async () => new FakeGit(),
    tasks: async () => null,
    tell: { sessions: () => {}, session: () => {} },
  })

const repos = ['/home/simon/code/app', '/home/simon/code/api']

describe('the folders a session may run in', () => {
  it('accepts the root, a repo, and a folder inside a repo (a worktree)', async () => {
    const s = service()
    for (const folder of ['/home/simon/code', '/home/simon/code/app', '/home/simon/code/app/.claude/worktrees/42-fix', '/home/simon/code/app/']) {
      expect(await s.allowsFolder(folder, repos), folder).toBe(true)
    }
  })

  it('refuses any other folder, a sibling by name, and a way out through ..', async () => {
    const s = service()
    for (const folder of ['/', '/etc', '/home/simon', '/home/simon/code/application', '/home/simon/code/other', '/home/simon/code/app/../../../etc', '']) {
      expect(await s.allowsFolder(folder, repos), folder).toBe(false)
    }
  })

  it('reads a Windows path as it is written', async () => {
    const s = service('C:\\code')
    expect(await s.allowsFolder('C:\\code\\app\\sub', ['C:\\code\\app'])).toBe(true)
    expect(await s.allowsFolder('C:\\Windows', ['C:\\code\\app'])).toBe(false)
  })
})

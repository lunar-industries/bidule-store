import { afterEach, describe, expect, test } from 'vitest'
import { PlaneClient, PlaneError, planeBase, waitFor } from '../server/client.ts'

describe('the address of an instance', () => {
  test('what was typed, without a slash nor the /api/v1 copied from the documentation', () => {
    expect(planeBase('plane.exemple.fr')).toBe('https://plane.exemple.fr')
    expect(planeBase(' https://plane.exemple.fr/ ')).toBe('https://plane.exemple.fr')
    expect(planeBase('https://plane.exemple.fr/api/v1/')).toBe('https://plane.exemple.fr')
    expect(planeBase('http://localhost:8080/plane/api')).toBe('http://localhost:8080/plane')
    expect(planeBase('')).toBeNull()
    expect(planeBase('http://')).toBeNull()
  })
})

describe('the pause Plane asks for', () => {
  test('Retry-After in seconds, else the rate limit’s reset, never more than a minute', () => {
    expect(waitFor(new Headers({ 'retry-after': '3' }))).toBe(3000)
    expect(waitFor(new Headers({ 'retry-after': '999' }))).toBe(65_000)
    expect(waitFor(new Headers({ 'x-ratelimit-reset': '10' }), 0)).toBe(10_000)
    // A date in seconds since 1970.
    expect(waitFor(new Headers({ 'x-ratelimit-reset': '2000000030' }), 2_000_000_000_000)).toBe(30_000)
    expect(waitFor(new Headers({ 'x-ratelimit-reset': '2000000100' }), 2_000_000_000_000)).toBe(65_000)
    expect(waitFor(new Headers())).toBeNull()
  })
})

const original = globalThis.fetch
afterEach(() => {
  globalThis.fetch = original
})

const json = (body: unknown, status = 200, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } })

describe('the client', () => {
  test('a list is read page after page, with the key in the header', async () => {
    const asked: { url: string; key: string | null }[] = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      asked.push({ url, key: new Headers(init.headers).get('x-api-key') })
      return url.includes('cursor=next')
        ? json({ results: [{ id: 'p2', name: 'Site', identifier: 'WEB' }], next_page_results: false })
        : json({ results: [{ id: 'p1', name: 'Accenta', identifier: 'ACC' }], next_page_results: true, next_cursor: 'next' })
    }) as typeof fetch
    const projects = await new PlaneClient('https://plane.test', 'secret').projects('accenta')
    expect(projects.map((p) => p.identifier)).toEqual(['ACC', 'WEB'])
    expect(asked.map((a) => a.key)).toEqual(['secret', 'secret'])
    expect(asked[0].url).toContain('/api/v1/workspaces/accenta/projects/?per_page=100')
  })

  test('a work item is read with its assignees and the date Plane gives', async () => {
    globalThis.fetch = (async () =>
      json({
        id: 'w1',
        project: 'p1',
        sequence_id: 12,
        name: 'Titre',
        state: 's1',
        assignees: ['me', 'u2'],
        description_html: '<p>x</p>',
        target_date: '2026-10-31',
        updated_at: '2026-10-06T08:00:00Z',
        updated_by: 'me',
      })) as typeof fetch
    const w = await new PlaneClient('https://plane.test', 'k').workItem('accenta', 'p1', 'w1')
    expect(w).toMatchObject({ id: 'w1', sequenceId: 12, assignees: ['me', 'u2'], targetDate: '2026-10-31', completedAt: null })
  })

  test('an answer of another shape fails naming Plane and the field', async () => {
    globalThis.fetch = (async () => json({ id: 'w1', name: 'Titre' })) as typeof fetch
    await expect(new PlaneClient('https://plane.test', 'k').workItem('a', 'p', 'w1')).rejects.toThrow(
      /Plane : réponse inattendue \(work item\.project\)/
    )
  })

  test('a refusal says what Plane says, with its status', async () => {
    globalThis.fetch = (async () => json({ error: 'Invalid API key' }, 401)) as typeof fetch
    const error = await new PlaneClient('https://plane.test', 'k').me().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PlaneError)
    expect(error).toMatchObject({ status: 401, message: 'Plane 401 : Invalid API key' })
  })

  test('an address that is not a Plane instance is told apart from a refusal', async () => {
    globalThis.fetch = (async () => json('<html>', 200, 'text/html')) as typeof fetch
    await expect(new PlaneClient('https://autre.test', 'k').me()).rejects.toThrow(/ne répond pas comme une instance Plane/)
  })

  test('an instance that cannot be reached is named in words the settings can show', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code: 'ENOTFOUND' }) })
    }) as typeof fetch
    await expect(new PlaneClient('https://nulle.part', 'k').me()).rejects.toThrow('Plane (https://nulle.part) : adresse introuvable')
  })

  test('the members are a list or a page of them, depending on the version of Plane', async () => {
    const member = { id: 'u1', display_name: 'Camille', email: 'c@x.fr' }
    globalThis.fetch = (async () => json([member])) as typeof fetch
    expect(await new PlaneClient('https://plane.test', 'k').members('a')).toHaveLength(1)
    globalThis.fetch = (async () => json({ results: [member, member] })) as typeof fetch
    expect(await new PlaneClient('https://plane.test', 'k').members('a')).toHaveLength(2)
  })
})

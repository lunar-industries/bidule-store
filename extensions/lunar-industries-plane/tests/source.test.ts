import { describe, expect, test } from 'vitest'
import { fakePlane, item, source } from './fakes.ts'

const NOTION = '1f6c1a2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b'

describe('the sync', () => {
  test('keeps the work items assigned to the user, with their reference, address and due date', async () => {
    const plane = fakePlane([
      item('w1', 'À moi', { sequenceId: 7, targetDate: '2026-10-31T00:00:00Z' }),
      item('w2', 'À un autre', { assignees: ['u2'] }),
      item('w3', 'À nous deux', { assignees: ['u2', 'me'], state: 's-doing', sequenceId: 9 }),
    ])
    const { tasks, mirror } = source(plane)
    const read = await tasks.syncCount()
    expect(read).toMatchObject({ tasks: 2, who: 'Simon' })
    const board = await tasks.board()
    expect(board.source).toBe('Plane')
    expect(board.configured).toBe(true)
    expect(board.tasks.map((t) => [t.id, t.title, t.status, t.ref, t.due, t.role])).toEqual([
      ['w1', 'À moi', 'À faire', 'ACC-7', '2026-10-31', 'owner'],
      ['w3', 'À nous deux', 'En cours', 'ACC-9', null, 'owner'],
    ])
    expect(board.tasks[0].url).toBe('https://plane.test/accenta/browse/ACC-7/')
    expect(board.columns.map((c) => [c.name, c.group])).toEqual([
      ['Backlog', 'todo'],
      ['À faire', 'todo'],
      ['En cours', 'doing'],
      ['En revue', 'doing'],
      ['Terminé', 'done'],
    ])
    expect(mirror.rows.get('w2')).toBeUndefined()
  })

  test('only the projects named in the settings are read', async () => {
    const plane = fakePlane([item('w1', 'Dans ACC')])
    const { tasks } = source(plane, { config: { projects: ['WEB'] } })
    expect((await tasks.syncCount()).tasks).toBe(0)
    const read = source(plane, { config: { projects: ['acc'] } })
    expect((await read.tasks.syncCount()).tasks).toBe(1)
  })

  test('a work item handed over or gone is hidden, and comes back when it is the user’s again', async () => {
    const plane = fakePlane([item('w1', 'Une'), item('w2', 'Deux')])
    const { tasks } = source(plane)
    await tasks.syncCount()
    plane.world.items = [item('w1', 'Une')]
    await tasks.syncCount()
    expect((await tasks.board()).tasks.map((t) => t.id)).toEqual(['w1'])
    plane.world.items = [item('w1', 'Une'), item('w2', 'Deux')]
    await tasks.syncCount()
    // By title: « Deux » comes before « Une ».
    expect((await tasks.board()).tasks.map((t) => t.id)).toEqual(['w2', 'w1'])
  })

  test('a state change and an edit by the user are kept as activity, dated by the work item', async () => {
    const plane = fakePlane([item('w1', 'Une'), item('w2', 'Deux')])
    const { tasks } = source(plane)
    await tasks.syncCount()
    plane.world.items = [
      item('w1', 'Une', { state: 's-doing', updatedAt: '2026-10-06T10:00:00.000Z', updatedBy: 'u2' }),
      item('w2', 'Deux renommée', { updatedAt: '2026-10-06T11:00:00.000Z', updatedBy: 'me' }),
    ]
    const read = await tasks.syncCount()
    expect(read).toMatchObject({ moves: 1, edits: 1 })
    expect(await tasks.statusChanges('2026-10-06T00:00:00Z', '2026-10-07T00:00:00Z')).toEqual([
      { at: '2026-10-06T10:00:00.000Z', taskId: 'w1', from: 'À faire', to: 'En cours', fromGroup: 'todo', toGroup: 'doing' },
    ])
    expect(await tasks.edits('2026-10-06T00:00:00Z', '2026-10-07T00:00:00Z')).toEqual([
      { at: '2026-10-06T11:00:00.000Z', taskId: 'w2' },
    ])
    // An edit by someone else, the status unchanged: nothing for the user.
    plane.world.items[1] = item('w2', 'Deux encore', { updatedAt: '2026-10-06T12:00:00.000Z', updatedBy: 'u2' })
    expect(await tasks.syncCount()).toMatchObject({ moves: 0, edits: 0 })
  })

  test('an unconfigured source says what is missing, and a bad key fails with Plane’s words', async () => {
    const none = source(fakePlane(), { config: { key: '' } })
    expect(await none.tasks.configured()).toBe(false)
    await expect(none.tasks.sync()).rejects.toThrow(/n’est pas configuré/)
    expect((await none.tasks.board()).configured).toBe(false)
    const noWorkspace = source(fakePlane(), { config: { workspace: ' ' } })
    expect(await noWorkspace.tasks.configured()).toBe(false)
  })
})

describe('the tasks migrated from Notion', () => {
  const described = (id: string) => `<p>Migrée depuis Notion : https://notion.so/${id.replaceAll('-', '')}</p>`

  test('a work item that names a Notion task the user has is its copy', async () => {
    const plane = fakePlane([
      item('w1', 'Migrée', { descriptionHtml: described(NOTION) }),
      item('w2', 'Autre', { descriptionHtml: described('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee') }),
      item('w3', 'Sans lien'),
    ])
    const { tasks } = source(plane, { others: new Map([[NOTION, NOTION]]) })
    await tasks.syncCount()
    const board = await tasks.board()
    // The Notion page the description names is not one of the user's tasks for w2: nothing is guessed.
    expect(board.tasks.map((t) => [t.title, t.copyOf])).toEqual([
      ['Autre', undefined],
      ['Migrée', [NOTION]],
      ['Sans lien', undefined],
    ])
  })

  test('the copy is told at each read: Notion’s task may arrive after the sync', async () => {
    const plane = fakePlane([item('w1', 'Migrée', { descriptionHtml: described(NOTION) })])
    const others = new Map<string, string>()
    const { tasks } = source(plane, { others })
    await tasks.syncCount()
    expect((await tasks.board()).tasks[0].copyOf).toBeUndefined()
    others.set(NOTION, NOTION)
    expect((await tasks.board()).tasks[0].copyOf).toEqual([NOTION])
  })
})

describe('moving a card', () => {
  test('goes to the state of that name in the work item’s project, and the move is kept as activity', async () => {
    const plane = fakePlane([item('w1', 'Une')])
    const { tasks, mirror } = source(plane)
    await tasks.syncCount()
    await tasks.move('w1', 'En revue')
    expect(plane.calls).toEqual(['setState w1 s-review'])
    expect((await tasks.board()).tasks[0].status).toBe('En revue')
    expect(mirror.changes).toMatchObject([{ taskId: 'w1', from: 'À faire', to: 'En revue' }])
  })

  test('a column Plane does not have takes the first state of the same group', async () => {
    const plane = fakePlane([item('w1', 'Une')])
    const { tasks, mirror } = source(plane)
    await tasks.syncCount()
    // « En attente » was a column of the board (Notion’s): its group is « doing ».
    mirror.columnList.push({ name: 'En attente', color: '', group: 'doing' })
    await tasks.move('w1', 'En attente')
    expect(plane.calls).toEqual(['setState w1 s-doing'])
    expect((await tasks.board()).tasks[0].status).toBe('En cours')
  })

  test('a status with no state and no group is refused, and so is a work item that is not here', async () => {
    const plane = fakePlane([item('w1', 'Une')])
    const { tasks } = source(plane)
    await tasks.syncCount()
    await expect(tasks.move('w1', 'Inconnu')).rejects.toThrow(/n'a pas d'état « Inconnu »/)
    await expect(tasks.move('nulle-part', 'Terminé')).rejects.toThrow(/Tâche Plane inconnue/)
    expect(plane.calls).toEqual([])
  })
})

describe('what an agent or a conversation reads', () => {
  test('the description then the comments, as text', async () => {
    const plane = fakePlane([item('w1', 'Une', { descriptionHtml: '<h2>But</h2><p>Faire <b>ça</b></p>' })])
    const { tasks } = source(plane)
    await tasks.syncCount()
    expect(await tasks.page('w1')).toEqual({
      text: '# But\nFaire ça',
      comments: [
        { at: '2026-10-05T10:00:00Z', text: 'Premier' },
        { at: '2026-10-05T11:00:00Z', text: 'Deuxième' },
      ],
    })
  })

  test('a comment goes to Plane as HTML', async () => {
    const plane = fakePlane([item('w1', 'Une')])
    const { tasks } = source(plane)
    await tasks.syncCount()
    await tasks.comment('w1', 'Fait.\nÀ relire & valider')
    expect(plane.comments).toEqual([{ item: 'w1', html: '<p>Fait.<br>À relire &amp; valider</p>' }])
  })

  test('the other people on the work item, named as the workspace names them, the user left out', async () => {
    const plane = fakePlane([item('w1', 'Une', { assignees: ['me', 'u2', 'inconnu'] })])
    const { tasks } = source(plane)
    await tasks.syncCount()
    expect(await tasks.people('w1')).toEqual([{ name: 'Camille Durand', email: 'camille@x.fr' }])
  })
})

describe('searching and taking on', () => {
  test('the search finds the user’s own work items by title, whatever the case', async () => {
    const plane = fakePlane([item('w1', 'Écran de connexion'), item('w2', 'Paiement')])
    const { tasks } = source(plane)
    await tasks.syncCount()
    expect((await tasks.search('CONNEX')).map((t) => t.id)).toEqual(['w1'])
    expect(await tasks.search('rien')).toEqual([])
  })

  test('a work item already the user’s is taken as it is, another one is for Plane to assign', async () => {
    const plane = fakePlane([item('w1', 'Une')])
    const { tasks } = source(plane)
    await tasks.syncCount()
    await expect(tasks.join('w1')).resolves.toBeUndefined()
    await expect(tasks.join('w9')).rejects.toThrow(/se prend dans Plane/)
  })
})

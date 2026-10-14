import { describe, expect, it } from 'vitest'
import {
  buildArgv,
  choicesOfFiles,
  filterChoices,
  initialValues,
  listedChoices,
  paramProblems,
  parseScriptsFile,
  pickAll,
  pickNone,
  previewParts,
  shownArgv,
  splitArgs,
  type FileScript,
} from '../scripts-file.ts'

const file = (scripts: unknown[]) => JSON.stringify({ scripts })

const UP = {
  name: 'up',
  title: 'Lancer des projets',
  command: ['./dev.sh', 'up', '{projects}', '{detach}', '{extra}'],
  params: {
    projects: { label: 'Projets', type: 'choice', multiple: true, required: true, choices: { files: 'compose/*.yml', strip: '.yml', exclude: ['base'] } },
    detach: { label: 'En arrière-plan', type: 'flag', value: '-d', default: true },
    extra: { label: 'Autres arguments', type: 'args' },
  },
}

function one(raw: unknown): FileScript {
  const { scripts, error } = parseScriptsFile(file([raw]))
  expect(error).toBeNull()
  return scripts[0]
}

describe('Terminal (Lunar Industries) · bidule.scripts.json', () => {
  it('reads a script, its parameters in the order of the command', () => {
    const s = one(UP)
    expect(s.title).toBe('Lancer des projets')
    expect(s.order).toEqual(['projects', 'detach', 'extra'])
    expect(s.params.projects).toMatchObject({ type: 'choice', multiple: true, required: true })
    expect(s.params.extra.required).toBe(false)
    // No title: the command.
    expect(one({ name: 'ls', command: ['ls', '-la'] }).title).toBe('ls -la')
  })

  it('refuses what it cannot run as written', () => {
    const error = (raw: unknown) => parseScriptsFile(file([raw])).error
    expect(parseScriptsFile('{').error).toMatch(/JSON valide/)
    expect(parseScriptsFile('{"tasks":[]}').error).toMatch(/"scripts"/)
    expect(error({ name: 'a b', command: ['ls'] })).toMatch(/name/)
    expect(error({ name: 'x', command: ['ls', '--name={n}'], params: { n: { label: 'N', type: 'text' } } })).toMatch(/argument entier/)
    expect(error({ name: 'x', command: ['ls', '{n}'] })).toMatch(/n'est pas dans « params »/)
    expect(error({ name: 'x', command: ['ls'], params: { n: { label: 'N', type: 'text' } } })).toMatch(/n'est pas dans « command »/)
    expect(error({ name: 'x', command: ['ls', '{n}', '{n}'], params: { n: { label: 'N', type: 'text' } } })).toMatch(/deux fois/)
    expect(error({ name: 'x', command: ['{n}'], params: { n: { label: 'N', type: 'text' } } })).toMatch(/programme/)
    expect(error({ name: 'x', command: ['/bin/rm'] })).toMatch(/programme/)
    expect(error({ name: 'x', command: ['../up.sh'] })).toMatch(/programme/)
    expect(error({ name: 'x', command: ['./../up.sh'] })).toMatch(/programme/)
    expect(error({ name: 'x', command: ['ls', '{f}'], params: { f: { label: 'F', type: 'flag' } } })).toMatch(/value/)
    expect(error({ name: 'x', command: ['ls', '{c}'], params: { c: { label: 'C', type: 'choice', choices: { files: '../*' } } } })).toMatch(/files/)
    expect(error({ name: 'x', command: ['ls', '{c}'], params: { c: { label: 'C', type: 'choice', choices: [] } } })).toMatch(/choices/)
    expect(error({ name: 'x', command: ['ls', '{t}'], params: { t: { label: 'T', type: 'shell' } } })).toMatch(/type/)
    expect(parseScriptsFile(file([{ name: 'x', command: ['ls'] }, { name: 'x', command: ['pwd'] }])).error).toMatch(/deux fois/)
  })

  it('splits free arguments like a shell, without expanding anything', () => {
    expect(splitArgs('')).toEqual([])
    expect(splitArgs('  -v   --name "a b"  ')).toEqual(['-v', '--name', 'a b'])
    expect(splitArgs(`'$HOME' "x\\"y" a\\ b ""`)).toEqual(['$HOME', 'x"y', 'a b', ''])
    expect(splitArgs('a;rm -rf x|y $(z)')).toEqual(['a;rm', '-rf', 'x|y', '$(z)'])
    expect(() => splitArgs('"open')).toThrow(/non fermé/)
  })

  it('builds the argv from the values', () => {
    const s = one(UP)
    const choices = { projects: ['api', 'db', 'web'] }
    // Each value one argument, in the list's order; the flag ticked; empty free arguments leave nothing.
    expect(buildArgv(s, { projects: ['web', 'api'], detach: true, extra: '' }, choices)).toEqual(['./dev.sh', 'up', 'api', 'web', '-d'])
    expect(buildArgv(s, { projects: ['db'], detach: false, extra: '--build "x y"' }, choices)).toEqual(['./dev.sh', 'up', 'db', '--build', 'x y'])
    expect(() => buildArgv(s, { projects: [], detach: true }, choices)).toThrow(/au moins une valeur/)
    expect(() => buildArgv(s, { projects: ['base'] }, choices)).toThrow(/n'est pas un choix possible/)
    expect(shownArgv(['./dev.sh', 'up', 'x y', "it's"])).toBe(`./dev.sh up 'x y' 'it'\\''s'`)
  })

  it('leaves out an empty optional text, requires a required one', () => {
    const s = one({
      name: 'log',
      command: ['git', 'log', '{since}', '{format}'],
      params: {
        since: { label: 'Depuis', type: 'text', required: true },
        format: { label: 'Format', type: 'choice', choices: ['oneline', 'short'], default: 'oneline' },
      },
    })
    expect(listedChoices(s)).toEqual({ format: ['oneline', 'short'] })
    expect(initialValues(s, null)).toEqual({ since: '', format: 'oneline' })
    // Last values of the wrong type fall back to the default.
    expect(initialValues(s, { since: 'yesterday', format: ['x'] })).toEqual({ since: 'yesterday', format: 'oneline' })
    expect(() => buildArgv(s, { since: '', format: '' }, listedChoices(s))).toThrow(/à remplir/)
    expect(buildArgv(s, { since: '2 days ago', format: '' }, listedChoices(s))).toEqual(['git', 'log', '2 days ago'])
    expect(() => buildArgv(s, { since: 'a\nb' }, listedChoices(s))).toThrow(/invalide/)
  })

  it('names the choices of files', () => {
    expect(choicesOfFiles(['compose/web.yml', 'compose/base.yml', 'compose/api.yml', 'compose/notes.txt'], { files: 'compose/*', strip: '.yml', exclude: ['base'] })).toEqual([
      'api',
      'notes.txt',
      'web',
    ])
  })
})

describe('Terminal (Lunar Industries) · the script form', () => {
  const choices = { projects: ['api', 'web', 'db'] }

  it('says what is wrong with each parameter, and nothing once filled', () => {
    const s = one(UP)
    expect(paramProblems(s, { projects: [], detach: true, extra: '' }, choices)).toEqual({ projects: 'Projets : choisis au moins une valeur' })
    expect(paramProblems(s, { projects: ['web'], detach: true, extra: '"open' }, choices)).toEqual({ extra: 'Guillemet " non fermé' })
    expect(paramProblems(s, { projects: ['web'], detach: false, extra: '' }, choices)).toEqual({})
  })

  it('previews the command, the parameters’ arguments apart, a missing one by its label', () => {
    const s = one(UP)
    expect(previewParts(s, { projects: ['web', 'api'], detach: true, extra: "--name 'a b'" }, choices)).toEqual([
      { text: './dev.sh' },
      { text: 'up' },
      { text: 'api', param: 'projects' },
      { text: 'web', param: 'projects' },
      { text: '-d', param: 'detach' },
      { text: '--name', param: 'extra' },
      { text: "'a b'", param: 'extra' },
    ])
    expect(previewParts(s, { projects: [], detach: false, extra: '' }, choices)).toEqual([
      { text: './dev.sh' },
      { text: 'up' },
      { text: '‹Projets›', param: 'projects', missing: true },
    ])
  })

  it('filters the choices by every word, accents and case ignored', () => {
    expect(filterChoices(['Élan', 'web-front', 'web-back', 'api'], 'WEB fr')).toEqual(['web-front'])
    expect(filterChoices(['Élan', 'api'], 'elan')).toEqual(['Élan'])
    expect(filterChoices(['a', 'b'], ' ')).toEqual(['a', 'b'])
  })

  it('ticks all or none of the choices shown, keeping the others', () => {
    expect(pickAll(['db'], ['api', 'db'])).toEqual(['db', 'api'])
    expect(pickNone(['db', 'web', 'api'], ['api', 'db'])).toEqual(['web'])
  })
})

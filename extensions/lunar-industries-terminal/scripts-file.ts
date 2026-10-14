// A repo's own commands, declared in `bidule.scripts.json` at its root: each one an argv whose whole elements `{param}`
// are replaced by what the user gives (a choice, a text, free arguments, a flag). Pure: the server reads the file and
// builds the argv it runs, the interface shows the form and a preview with the same functions. Nothing is ever read by a
// shell: free arguments are split as a shell would (quotes, backslashes) but never expanded.

export const SCRIPTS_FILE = 'bidule.scripts.json'
// The file is read up to this size.
export const SCRIPTS_FILE_MAX = 256 * 1024

export type ParamType = 'choice' | 'text' | 'args' | 'flag'
const TYPES: ParamType[] = ['choice', 'text', 'args', 'flag']

// A choice's values: listed, or the names of the repo's files a pattern matches (`compose/*.yml`, `.yml` stripped).
export type ChoicesFrom = { files: string; strip?: string; exclude?: string[] }

export type FileParam = {
  label: string
  type: ParamType
  required: boolean
  // A choice: one value, or several (each one more argument, in the list's order).
  multiple?: boolean
  choices?: string[] | ChoicesFrom
  placeholder?: string
  // A flag: the argument added when it is ticked.
  value?: string
  default?: string | string[] | boolean
}

export type FileScript = {
  name: string
  title: string
  description: string
  command: string[]
  params: Record<string, FileParam>
  // The parameters in the order the command uses them (the form's order).
  order: string[]
}

export type ScriptValue = string | string[] | boolean
export type ScriptValues = Record<string, ScriptValue>

export const FILE_SCRIPT_NAME = /^[A-Za-z0-9:._-]{1,100}$/
const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,50}$/
const WHOLE = /^\{([A-Za-z_][A-Za-z0-9_]{0,50})\}$/
const PARTIAL = /\{[A-Za-z_][A-Za-z0-9_]*\}/
// A program by its name (looked up in the PATH), never a path but one relative to the repo.
const PROGRAM = /^[A-Za-z0-9._+-]{1,100}$/

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && !/[\0\r\n]/.test(v)

// A path relative to the repo, which stays in it: no absolute path, no `..`.
export function relativeInRepo(path: string): boolean {
  if (!path || path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path) || path.includes('\0')) return false
  return !path.split(/[\\/]/).some((part) => part === '..')
}

class FileError extends Error {}
const fail = (message: string): never => {
  throw new FileError(message)
}

function parseParam(script: string, name: string, raw: unknown): FileParam {
  const where = `${script} › ${name}`
  if (!PARAM_NAME.test(name)) fail(`${where} : nom de paramètre invalide`)
  if (!isObject(raw)) fail(`${where} : un objet est attendu`)
  const p = raw as Record<string, unknown>
  if (!isText(p.label, 100) || !p.label) fail(`${where} : « label » manque`)
  if (!TYPES.includes(p.type as ParamType)) fail(`${where} : « type » doit être choice, text, args ou flag`)
  const type = p.type as ParamType
  if (p.required !== undefined && typeof p.required !== 'boolean') fail(`${where} : « required » est vrai ou faux`)
  const param: FileParam = { label: p.label as string, type, required: p.required === true }
  if (p.placeholder !== undefined) {
    if (!isText(p.placeholder, 200)) fail(`${where} : « placeholder » invalide`)
    param.placeholder = p.placeholder as string
  }
  if (type === 'choice') {
    if (p.multiple !== undefined && typeof p.multiple !== 'boolean') fail(`${where} : « multiple » est vrai ou faux`)
    param.multiple = p.multiple === true
    if (Array.isArray(p.choices)) {
      if (!p.choices.length || p.choices.length > 200 || !p.choices.every((c) => isText(c, 200) && c !== ''))
        fail(`${where} : « choices » : 1 à 200 textes non vides`)
      param.choices = p.choices as string[]
    } else if (isObject(p.choices)) {
      const c = p.choices
      if (!isText(c.files, 200) || !relativeInRepo(c.files as string)) fail(`${where} : « choices.files » : un motif relatif au dépôt`)
      if (c.strip !== undefined && !isText(c.strip, 50)) fail(`${where} : « choices.strip » invalide`)
      if (c.exclude !== undefined && (!Array.isArray(c.exclude) || !c.exclude.every((e) => isText(e, 200))))
        fail(`${where} : « choices.exclude » : une liste de textes`)
      param.choices = {
        files: c.files as string,
        ...(c.strip !== undefined ? { strip: c.strip as string } : {}),
        ...(c.exclude !== undefined ? { exclude: c.exclude as string[] } : {}),
      }
    } else fail(`${where} : « choices » : une liste, ou { "files": … }`)
    if (p.default !== undefined) {
      const ok = param.multiple
        ? Array.isArray(p.default) && p.default.every((d) => isText(d, 200))
        : isText(p.default, 200)
      if (!ok) fail(`${where} : « default » invalide`)
      param.default = p.default as string | string[]
    }
  } else if (type === 'flag') {
    if (!isText(p.value, 200) || !p.value) fail(`${where} : « value » (l'argument ajouté) manque`)
    param.value = p.value as string
    if (p.default !== undefined && typeof p.default !== 'boolean') fail(`${where} : « default » est vrai ou faux`)
    if (p.default !== undefined) param.default = p.default as boolean
  } else if (p.default !== undefined) {
    if (!isText(p.default, 1000)) fail(`${where} : « default » invalide`)
    param.default = p.default as string
  }
  return param
}

function parseScript(raw: unknown, index: number): FileScript {
  if (!isObject(raw)) fail(`Script ${index + 1} : un objet est attendu`)
  const s = raw as Record<string, unknown>
  if (typeof s.name !== 'string' || !FILE_SCRIPT_NAME.test(s.name)) fail(`Script ${index + 1} : « name » invalide (lettres, chiffres, : . _ -)`)
  const name = s.name as string
  if (s.title !== undefined && !isText(s.title, 200)) fail(`${name} : « title » invalide`)
  if (s.description !== undefined && !isText(s.description, 500)) fail(`${name} : « description » invalide`)
  if (!Array.isArray(s.command) || !s.command.length || s.command.length > 100 || !s.command.every((a) => isText(a, 1000)))
    fail(`${name} : « command » : une liste de 1 à 100 textes`)
  const command = s.command as string[]
  const program = command[0]
  if (WHOLE.test(program) || PARTIAL.test(program)) fail(`${name} : le programme ne peut pas être un paramètre`)
  if (!(program.startsWith('./') && relativeInRepo(program.slice(2))) && !PROGRAM.test(program))
    fail(`${name} : le programme est un chemin du dépôt (./dev.sh) ou un nom sans « / »`)
  const rawParams = s.params === undefined ? {} : s.params
  if (!isObject(rawParams)) fail(`${name} : « params » : un objet`)
  const params: Record<string, FileParam> = {}
  for (const [key, value] of Object.entries(rawParams as Record<string, unknown>)) params[key] = parseParam(name, key, value)
  const order: string[] = []
  for (const arg of command.slice(1)) {
    const m = WHOLE.exec(arg)
    if (m) {
      if (!params[m[1]]) fail(`${name} : « {${m[1]}} » n'est pas dans « params »`)
      if (order.includes(m[1])) fail(`${name} : « {${m[1]}} » est utilisé deux fois`)
      order.push(m[1])
    } else if (PARTIAL.test(arg)) {
      fail(`${name} : « ${arg} » : un paramètre remplace un argument entier (« {x} »), pas une partie`)
    }
  }
  for (const key of Object.keys(params)) if (!order.includes(key)) fail(`${name} : le paramètre « ${key} » n'est pas dans « command »`)
  return {
    name,
    title: (s.title as string | undefined) || command.join(' '),
    description: (s.description as string | undefined) ?? '',
    command,
    params,
    order,
  }
}

// The file's scripts, or why it cannot be read (then none: a file half valid is not used).
export function parseScriptsFile(text: string): { scripts: FileScript[]; error: string | null } {
  if (text.length > SCRIPTS_FILE_MAX) return { scripts: [], error: `${SCRIPTS_FILE} dépasse ${SCRIPTS_FILE_MAX / 1024} Ko` }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    return { scripts: [], error: `${SCRIPTS_FILE} n'est pas du JSON valide : ${(err as Error).message}` }
  }
  try {
    if (!isObject(data) || !Array.isArray(data.scripts)) fail(`${SCRIPTS_FILE} : { "scripts": [ … ] } est attendu`)
    const list = (data as { scripts: unknown[] }).scripts
    if (list.length > 100) fail(`${SCRIPTS_FILE} : 100 scripts au plus`)
    const scripts = list.map(parseScript)
    const names = new Set<string>()
    for (const s of scripts) {
      if (names.has(s.name)) fail(`${SCRIPTS_FILE} : « ${s.name} » est déclaré deux fois`)
      names.add(s.name)
    }
    return { scripts, error: null }
  } catch (err) {
    if (err instanceof FileError) return { scripts: [], error: err.message }
    throw err
  }
}

/**
 * Free arguments split as a POSIX shell would (whitespace separates; single quotes keep everything; double quotes keep
 * everything but `\"` and `\\`; a backslash outside quotes keeps the next character), and nothing else: no variable, no
 * pattern, no `;` or `|` read as such — they are characters of an argument.
 */
export function splitArgs(text: string): string[] {
  const out: string[] = []
  let current = ''
  let started = false
  let quote: "'" | '"' | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote === "'") {
      if (c === "'") quote = null
      else current += c
    } else if (quote === '"') {
      if (c === '"') quote = null
      else if (c === '\\' && (text[i + 1] === '"' || text[i + 1] === '\\')) current += text[++i]
      else current += c
    } else if (c === "'" || c === '"') {
      quote = c
      started = true
    } else if (c === '\\') {
      if (i + 1 < text.length) current += text[++i]
      started = true
    } else if (/\s/.test(c)) {
      if (started) out.push(current)
      current = ''
      started = false
    } else {
      current += c
      started = true
    }
  }
  if (quote) throw new Error(`Guillemet ${quote} non fermé`)
  if (started) out.push(current)
  return out
}

// The values a form starts with: the last ones used, else each parameter's default.
export function initialValues(script: FileScript, last: ScriptValues | null): ScriptValues {
  const values: ScriptValues = {}
  for (const key of script.order) {
    const p = script.params[key]
    const kept = last?.[key]
    const fallback = p.default ?? (p.type === 'flag' ? false : p.type === 'choice' && p.multiple ? [] : '')
    values[key] = kept !== undefined && typeof kept === typeof fallback && Array.isArray(kept) === Array.isArray(fallback) ? kept : fallback
  }
  return values
}

// The arguments one parameter adds with its value (none when it is left empty). Throws, in words for the user, on a
// missing value or one not allowed. `allowed`: a choice's possible values.
export function paramArgs(p: FileParam, value: ScriptValue | undefined, allowed: string[]): string[] {
  if (p.type === 'flag') return value === true && p.value ? [p.value] : []
  if (p.type === 'choice') {
    const picked = (p.multiple ? (Array.isArray(value) ? value : []) : typeof value === 'string' && value ? [value] : []).filter(
      (v) => typeof v === 'string',
    )
    if (!picked.length) {
      if (p.required) throw new Error(`${p.label} : choisis ${p.multiple ? 'au moins une valeur' : 'une valeur'}`)
      return []
    }
    for (const v of picked) if (!allowed.includes(v)) throw new Error(`${p.label} : « ${v} » n'est pas un choix possible`)
    // In the list's order, once each.
    return allowed.filter((v) => picked.includes(v))
  }
  const text = typeof value === 'string' ? value : ''
  if (/[\0\r\n]/.test(text) || text.length > 1000) throw new Error(`${p.label} : texte invalide`)
  const parts = p.type === 'text' ? (text ? [text] : []) : splitArgs(text)
  if (!parts.length && p.required) throw new Error(`${p.label} : à remplir`)
  return parts
}

/**
 * The argv a script runs with these values. `choices`: each choice parameter's allowed values (the file's list, or the
 * names its pattern matched, which the server resolves). Throws, in words for the user, on a missing value or one not
 * allowed.
 */
export function buildArgv(script: FileScript, values: ScriptValues, choices: Record<string, string[]>): string[] {
  const argv: string[] = []
  for (const arg of script.command) {
    const m = WHOLE.exec(arg)
    if (!m) argv.push(arg)
    else argv.push(...paramArgs(script.params[m[1]], values[m[1]], choices[m[1]] ?? []))
  }
  return argv
}

// What is wrong with each parameter's value, by parameter (none: an empty object).
export function paramProblems(script: FileScript, values: ScriptValues, choices: Record<string, string[]>): Record<string, string> {
  const problems: Record<string, string> = {}
  for (const key of script.order) {
    try {
      paramArgs(script.params[key], values[key], choices[key] ?? [])
    } catch (err) {
      problems[key] = err instanceof Error ? err.message : String(err)
    }
  }
  return problems
}

// A piece of the command's preview: a fixed argument, one a parameter gave (`param`), or a parameter still missing
// (`missing`, its label in place of a value).
export type PreviewPart = { text: string; param?: string; missing?: boolean }

// The command as the form shows it while it is filled: each argument quoted as a shell would need it.
export function previewParts(script: FileScript, values: ScriptValues, choices: Record<string, string[]>): PreviewPart[] {
  const parts: PreviewPart[] = []
  for (const arg of script.command) {
    const m = WHOLE.exec(arg)
    if (!m) {
      parts.push({ text: shownArgv([arg]) })
      continue
    }
    const p = script.params[m[1]]
    try {
      for (const a of paramArgs(p, values[m[1]], choices[m[1]] ?? [])) parts.push({ text: shownArgv([a]), param: m[1] })
    } catch {
      parts.push({ text: `‹${p.label}›`, param: m[1], missing: true })
    }
  }
  return parts
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

// A choice's values that every word of the filter is in (accents and case ignored).
export function filterChoices(choices: string[], filter: string): string[] {
  const words = fold(filter).split(/\s+/).filter(Boolean)
  return choices.filter((c) => words.every((w) => fold(c).includes(w)))
}

// A multiple choice with every one of `shown` ticked (« Tout »), or none of them (« Aucun »); the others kept.
export function pickAll(picked: string[], shown: string[]): string[] {
  return [...picked, ...shown.filter((c) => !picked.includes(c))]
}
export function pickNone(picked: string[], shown: string[]): string[] {
  return picked.filter((c) => !shown.includes(c))
}

// The allowed values of the choices given as a list; those from files are the server's to resolve.
export function listedChoices(script: FileScript): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const key of script.order) {
    const c = script.params[key].choices
    if (Array.isArray(c)) out[key] = c
  }
  return out
}

// The names of files a choice offers: the file's name, its suffix `strip` removed, those in `exclude` left out, sorted.
export function choicesOfFiles(paths: string[], from: ChoicesFrom): string[] {
  const names = paths.map((p) => {
    const base = p.split(/[\\/]/).pop() ?? p
    return from.strip && base.endsWith(from.strip) ? base.slice(0, -from.strip.length) : base
  })
  return [...new Set(names)].filter((n) => n && !(from.exclude ?? []).includes(n)).sort((a, b) => a.localeCompare(b)).slice(0, 200)
}

// A command line as the preview and the tab's title show it: each argument quoted when it needs to be.
export function shownArgv(argv: string[]): string {
  return argv.map((a) => (/^[A-Za-z0-9_./:=@%+,-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ')
}

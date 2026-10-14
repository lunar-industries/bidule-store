import type { ScriptValue, ScriptValues } from '../scripts-file.ts'

// The values last used for each script of a `bidule.scripts.json`, by `<repo>\n<name>` (keptKey), the most recent last:
// KEPT_MAX scripts at most, the oldest dropped. Kept by the API in the hidden setting `lunar-industries-terminal.scriptValues`.
export type KeptValues = Record<string, ScriptValues>
export const KEPT_MAX = 50

export const keptKey = (repo: string, name: string) => `${repo}\n${name}`

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isValue = (v: unknown): v is ScriptValue =>
  typeof v === 'string' || typeof v === 'boolean' || (Array.isArray(v) && v.every((x) => typeof x === 'string'))

// What the API gives back, checked: an object of scripts, each an object of texts, booleans or lists of texts. A
// script or a value of another kind is dropped; null when it is not an object at all.
export function keptValues(raw: unknown): KeptValues | null {
  if (!isRecord(raw)) return null
  const kept: KeptValues = {}
  for (const [key, values] of Object.entries(raw)) {
    if (isRecord(values)) kept[key] = Object.fromEntries(Object.entries(values).filter((e): e is [string, ScriptValue] => isValue(e[1])))
  }
  return kept
}

// The script's values put last (in place of the ones it had), the oldest dropped beyond KEPT_MAX.
export function rememberValues(all: KeptValues, repo: string, name: string, values: ScriptValues): KeptValues {
  const key = keptKey(repo, name)
  const others = Object.entries(all).filter(([k]) => k !== key)
  return Object.fromEntries([...others.slice(Math.max(0, others.length - (KEPT_MAX - 1))), [key, values]])
}

import vine from '@vinejs/vine'
import { RUNNERS, SCRIPT_NAME } from '../scripts.ts'

const folder = vine.string().trim().minLength(1).maxLength(4096)

export const scriptsValidator = vine.create({ cwd: folder.clone().optional(), repo: folder.clone().optional() })

// A script of its files (runner and name), or of its bidule.scripts.json (`source: 'file'`, its name and the values
// given; checked against the file by the service).
export const runValidator = vine.create({
  repo: folder.clone(),
  source: vine.enum(['file'] as const).optional(),
  runner: vine.enum(RUNNERS).optional(),
  name: vine.string().regex(SCRIPT_NAME),
  values: vine.record(vine.any()).optional(),
})

export const branchValidator = vine.create({
  branchId: vine.string().trim().minLength(1).maxLength(100),
})

export const reviewValidator = vine.create({
  cwd: folder.clone(),
  kind: vine.enum(['mr', 'pr'] as const),
  number: vine.number().withoutDecimals().min(1).max(10_000_000),
})

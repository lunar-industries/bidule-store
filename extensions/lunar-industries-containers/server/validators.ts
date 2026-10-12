import vine from '@vinejs/vine'
import { CONTAINER_ACTIONS } from '../contract.ts'

export const actionValidator = vine.create({
  action: vine.enum(CONTAINER_ACTIONS),
})

export const terminalValidator = vine.create({
  kind: vine.enum(['shell', 'logs'] as const),
})

// A folder inside the container, from its root.
export const filesValidator = vine.create({
  path: vine.string().startsWith('/').maxLength(4096),
})

// A follow the page stops, by the id its request got.
export const unfollowValidator = vine.create({
  params: vine.object({ follow: vine.string().regex(/^[\w-]{1,64}$/) }),
})

// The containers ticked, as `engine:id`.
export const selectionValidator = vine.create({
  keys: vine.array(vine.string().maxLength(200)).maxLength(1000),
})

import vine from '@vinejs/vine'

// The commands' arguments: the modules send them, but the interface can run a command too (POST /api/commands/:id).
const text = () => vine.string().trim().minLength(1)

export const filterValidator = vine.create({ taskId: text().optional(), repo: text().optional(), name: text().optional() })
export const linkValidator = vine.create({ repo: text(), name: text(), taskId: text().nullable() })
export const setTasksValidator = vine.create({ repo: text(), name: text(), taskIds: vine.array(text()) })
export const targetValidator = vine.create({ repo: text(), target: text().nullable() })

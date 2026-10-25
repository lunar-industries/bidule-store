import { useEffect, useState } from 'react'
import { announce, setAttention, useOn, type Attention } from '@bidule/sdk'
import { followSessions, PATH, useEnabled, useSessions } from './state.ts'

const SOURCE = 'lunar-industries-claude'

/**
 * Always there while the module is on (Simon's ClaudeSessions and the notifications his API sent), through the core's
 * « T'attend », which decides who says what: a session waiting for a decision, and one whose turn ended in error, are
 * in its list; a turn that ended and the executable slot taken are announced. A line opens its session.
 */
export function Background() {
  const enabled = useEnabled()
  useEffect(() => {
    if (enabled === false) void setAttention(SOURCE, []).catch(() => undefined)
  }, [enabled])
  return enabled ? <Following /> : null
}

function Following() {
  const sessions = useSessions()
  // The sessions whose turn ended in error, until they run again.
  const [failed, setFailed] = useState<Map<string, string>>(new Map())
  useEffect(followSessions, [])

  useOn('lunar-industries-claude.session', ({ id, message }) => {
    if (message.type !== 'notice') return
    if (message.kind === 'error') setFailed((f) => new Map(f).set(id, message.body))
    else if (message.kind === 'turn' || message.kind === 'slot')
      void announce({
        kind: message.kind === 'turn' ? 'turn' : 'news',
        title: message.title,
        detail: message.body,
        path: `${PATH}?session=${encodeURIComponent(id)}`,
      }).catch(() => undefined)
  })

  useEffect(() => {
    const live = (sessions ?? []).filter((s) => !s.archived)
    const items: Attention[] = []
    for (const s of live) {
      const path = `${PATH}?session=${encodeURIComponent(s.id)}`
      const task = s.taskId ? { task: s.taskId } : {}
      if (s.status === 'waiting')
        items.push({
          key: `session:${s.id}`,
          kind: 'decision',
          title: 'Claude attend ta décision',
          detail: s.task?.ref ? `${s.task.ref} · ${s.title}` : s.title,
          who: { kind: 'agent', name: 'Claude' },
          path,
          ...task,
        })
      const error = failed.get(s.id)
      if (error !== undefined && s.status !== 'running')
        items.push({
          key: s.id,
          kind: 'turn',
          title: 'Claude s’est arrêté sur une erreur',
          detail: error || s.title,
          who: { kind: 'agent', name: 'Claude' },
          path,
          ...task,
        })
    }
    void setAttention(SOURCE, items).catch(() => undefined)
  }, [sessions, failed])

  // A session that runs again is no longer in error.
  useEffect(() => {
    const running = (sessions ?? []).filter((s) => s.status === 'running' && failed.has(s.id))
    if (running.length) setFailed((f) => new Map([...f].filter(([id]) => !running.some((s) => s.id === id))))
  }, [sessions, failed])
  return null
}

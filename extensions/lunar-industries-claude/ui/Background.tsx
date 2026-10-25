import { useEffect } from 'react'
import { useOn, useSettingValues } from '@bidule/sdk'
import { notifyKinds } from './events.ts'
import { followSessions, openSession, PATH, useEnabled, useSelected } from './state.ts'

/**
 * Always there while the module is on (Simon's ClaudeSessions and the notifications his API sent): the system says
 * what the `notify` setting asks for (a decision expected, a turn ended, an error, the executable slot taken). A click
 * on a notification opens its session.
 */
export function Background() {
  const enabled = useEnabled()
  return enabled ? <Following /> : null
}

function Following() {
  const selected = useSelected()
  const values = useSettingValues()
  useEffect(followSessions, [])

  useOn('lunar-industries-claude.session', ({ id, message }) => {
    if (message.type !== 'notice' || !notifyKinds(values?.['lunar-industries-claude.notify']).has(message.kind)) return
    // The session already in front of the user tells it itself.
    const watching = !document.hidden && document.hasFocus() && location.pathname === PATH && selected === id
    if (watching || typeof Notification === 'undefined') return
    const n = new Notification(message.title, { body: message.body, silent: message.kind !== 'decision' })
    n.onclick = () => {
      window.focus()
      openSession(id)
    }
  })
  return null
}

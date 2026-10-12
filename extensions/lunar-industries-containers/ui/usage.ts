import { useEffect, useRef, useState } from 'react'
import { useOn } from '@bidule/sdk'
import type { Usage } from '../contract.ts'
import { api } from './api.ts'

// Kept across visits while the app runs: the meters show the last measure until the next one.
let keptUsage: Usage | null = null

// What the running containers use, followed by the engines while `on` (the list or a container's view shows it): each
// of their measures comes as the module's event; the engines are not asked for numbers nobody looks at.
export function useUsage(on: boolean): Usage | null {
  const [usage, setUsage] = useState<Usage | null>(keptUsage)
  // The follow this hook asked for (subscribed first, then asked: a measure before its answer is left for the next).
  const following = useRef<string | null>(null)
  const show = (measure: Usage) => {
    keptUsage = measure
    setUsage(measure)
  }
  useOn('lunar-industries-containers.usage', (event) => {
    if (event.follow === following.current && event.usage) show(event.usage)
  })
  useEffect(() => {
    if (!on) return
    let live = true
    let mine: string | null = null
    api.usage.follow({}).then(
      ({ follow, usage: last }) => {
        // No engine: nothing followed.
        if (!follow) return
        if (!live) return void api.unfollow({ params: { follow } }).catch(() => undefined)
        mine = follow
        following.current = follow
        if (last) show(last)
      },
      // No numbers: the meters keep the last ones.
      () => undefined
    )
    return () => {
      live = false
      following.current = null
      if (mine) void api.unfollow({ params: { follow: mine } }).catch(() => undefined)
    }
  }, [on])
  return usage
}

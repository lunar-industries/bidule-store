// @vitest-environment happy-dom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { allTicks, nextTicks, useListKeys } from './list.ts'

afterEach(cleanup)

const IDS = ['web', 'db', 'cache', 'worker']

function List({ open, toggle, remove }: { open: (id: string) => void; toggle: (id: string) => void; remove: (id: string) => void }) {
  const [active, setActive] = useState<string | null>(null)
  const { rowProps } = useListKeys({ ids: IDS, active, setActive, onOpen: open, onToggle: toggle, onDelete: remove, page: 2 })
  return (
    <ul>
      {IDS.map((id) => (
        <li key={id} {...rowProps(id)}>
          {id}
          <button type="button">shell de {id}</button>
        </li>
      ))}
    </ul>
  )
}

describe('Liste au clavier', () => {
  it('is one stop of Tab, and the arrows, Home, End and pages move the focus', () => {
    render(<List open={vi.fn()} toggle={vi.fn()} remove={vi.fn()} />)
    const row = (id: string) => screen.getByText(id, { selector: 'li > :first-child, li' })
    const rows = screen.getAllByRole('listitem')
    expect(rows.map((r) => r.tabIndex)).toEqual([0, -1, -1, -1])
    rows[0].focus()
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[1])
    expect(rows.map((r) => r.tabIndex)).toEqual([-1, 0, -1, -1])
    fireEvent.keyDown(rows[1], { key: 'End' })
    expect(document.activeElement).toBe(rows[3])
    fireEvent.keyDown(rows[3], { key: 'PageUp' })
    expect(document.activeElement).toBe(rows[1])
    fireEvent.keyDown(rows[1], { key: 'Home' })
    expect(document.activeElement).toBe(rows[0])
    fireEvent.keyDown(rows[0], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(rows[0])
    expect(row('web')).toBeTruthy()
  })

  it('opens, ticks and removes the row with Enter, Space and Delete, but leaves the keys of its buttons alone', () => {
    const open = vi.fn()
    const toggle = vi.fn()
    const remove = vi.fn()
    render(<List open={open} toggle={toggle} remove={remove} />)
    const rows = screen.getAllByRole('listitem')
    fireEvent.keyDown(rows[2], { key: 'Enter' })
    fireEvent.keyDown(rows[2], { key: ' ' })
    fireEvent.keyDown(rows[2], { key: 'Delete' })
    expect(open).toHaveBeenCalledWith('cache')
    expect(toggle).toHaveBeenCalledWith('cache')
    expect(remove).toHaveBeenCalledWith('cache')
    fireEvent.keyDown(screen.getByRole('button', { name: 'shell de db' }), { key: 'Enter' })
    expect(open).toHaveBeenCalledTimes(1)
  })
})

describe('Cases cochées', () => {
  it('ticks one row, then a range with Shift from the last one ticked', () => {
    let state = nextTicks(new Set(), IDS, 'db', { shift: false, anchor: null })
    expect([...state.ticked]).toEqual(['db'])
    state = nextTicks(state.ticked, IDS, 'worker', { shift: true, anchor: state.anchor })
    expect([...state.ticked].sort()).toEqual(['cache', 'db', 'worker'])
    // Unticking the anchor, then Shift: the range takes its state, unticked.
    state = nextTicks(state.ticked, IDS, 'db', { shift: false, anchor: state.anchor })
    state = nextTicks(state.ticked, IDS, 'cache', { shift: true, anchor: state.anchor })
    expect([...state.ticked]).toEqual(['worker'])
  })

  it('ticks every row shown, or none when they all were, keeping the hidden ones', () => {
    expect([...allTicks(new Set(['hidden']), ['web', 'db'])].sort()).toEqual(['db', 'hidden', 'web'])
    expect([...allTicks(new Set(['hidden', 'web', 'db']), ['web', 'db'])]).toEqual(['hidden'])
  })
})

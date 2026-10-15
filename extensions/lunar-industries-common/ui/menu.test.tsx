// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { isMenuKey, useMenu, type MenuEntry } from './menu.tsx'

afterEach(cleanup)

function Row({ entries }: { entries: MenuEntry[] }) {
  const [menu, open] = useMenu()
  return (
    <div>
      <button type="button" onClick={(e) => open(e.currentTarget, entries, 'Actions sur web')}>
        ⋯
      </button>
      <div tabIndex={0} onContextMenu={(e) => open(e, entries, 'Actions sur web')}>
        ligne
      </div>
      <button type="button">ailleurs</button>
      {menu}
    </div>
  )
}

const focused = () => document.activeElement?.textContent

describe('Menu commun', () => {
  it('moves with the arrows, Home, End and a letter, skipping nothing, and runs an item once closed', async () => {
    const start = vi.fn()
    render(
      <Row
        entries={[
          { label: 'Démarrer', run: start },
          false,
          'separator',
          { label: 'Arrêter', run: vi.fn(), disabled: 'Il ne tourne pas' },
          { label: 'Supprimer…', run: vi.fn() },
        ]}
      />,
    )
    const button = screen.getByRole('button', { name: '⋯' })
    fireEvent.click(button)
    const menu = screen.getByRole('menu', { name: 'Actions sur web' })
    expect(focused()).toBe('Démarrer')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(focused()).toBe('Arrêter')
    expect(screen.getByRole('menuitem', { name: 'Arrêter' }).getAttribute('title')).toBe('Il ne tourne pas')
    fireEvent.keyDown(menu, { key: 'End' })
    expect(focused()).toBe('Supprimer…')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(focused()).toBe('Démarrer')
    fireEvent.keyDown(menu, { key: 's' })
    expect(focused()).toBe('Supprimer…')
    fireEvent.keyDown(menu, { key: 'Home' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Démarrer' }))
    expect(screen.queryByRole('menu')).toBeNull()
    // The focus is back on « ⋯ » before the item runs.
    expect(document.activeElement).toBe(button)
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1))
  })

  it('does nothing for a disabled item, and keeps only the separators between items', () => {
    const stop = vi.fn()
    render(<Row entries={['separator', { label: 'Arrêter', run: stop, disabled: true }, 'separator']} />)
    fireEvent.click(screen.getByRole('button', { name: '⋯' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Arrêter' }))
    expect(stop).not.toHaveBeenCalled()
    expect(document.querySelectorAll('.menu-sep')).toHaveLength(0)
  })

  it('closes on Escape and gives the focus back, and a second click on its button closes it', () => {
    render(<Row entries={[{ label: 'Démarrer', run: vi.fn() }]} />)
    const button = screen.getByRole('button', { name: '⋯' })
    fireEvent.click(button)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(button)
    fireEvent.click(button)
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.pointerDown(button)
    fireEvent.click(button)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on a click elsewhere without taking the focus there', () => {
    render(<Row entries={[{ label: 'Démarrer', run: vi.fn() }]} />)
    fireEvent.contextMenu(screen.getByText('ligne'), { clientX: 40, clientY: 50 })
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'ailleurs' }))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('knows the keys that open a menu', () => {
    expect(isMenuKey({ key: 'ContextMenu', shiftKey: false })).toBe(true)
    expect(isMenuKey({ key: 'F10', shiftKey: true })).toBe(true)
    expect(isMenuKey({ key: 'F10', shiftKey: false })).toBe(false)
  })
})

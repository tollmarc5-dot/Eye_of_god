// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { adaptGraphify } from '@/data'
import { ExplorerRail } from '@/features/hud/ExplorerRail'
import { Legend } from '@/features/hud/Legend'
import { SearchBox } from '@/features/search/SearchBox'
import { DEFAULT_FILTERS } from '@/graph'
import { buildSearchIndex } from '@/search'
import { useAppStore } from '@/state/store'
import { makeRawGraph } from './fixtures'

const initialState = useAppStore.getState()

beforeEach(() => {
  useAppStore.setState({ ...initialState, filters: DEFAULT_FILTERS }, true)
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('legend', () => {
  test('folded by default; the button opens the key and says so', () => {
    render(<Legend />)
    const toggle = screen.getByRole('button', { name: 'Legend' })

    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('region', { name: 'Legend' })).toBeNull()

    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const key = screen.getByRole('region', { name: 'Legend' })
    // Every mark is explained in words, never by colour alone.
    expect(key.textContent).toContain('third-party code')
    expect(key.textContent).toContain('the selected node')
  })

  test('Escape folds it and gives the focus back to its button', () => {
    render(<Legend />)
    const toggle = screen.getByRole('button', { name: 'Legend' })
    fireEvent.click(toggle)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle)
  })

  test('a click anywhere else folds it', () => {
    render(<Legend />)
    fireEvent.click(screen.getByRole('button', { name: 'Legend' }))

    fireEvent.pointerDown(document.body)

    expect(screen.getByRole('button', { name: 'Legend' }).getAttribute('aria-expanded')).toBe('false')
  })
})

describe('explorer rail', () => {
  test('every button opens the explorer; a section button also unfolds and reaches its section', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 0
    })
    useAppStore.getState().setPanel('explorer', false)
    // The explorer's communities section, folded, as ExplorerPanel renders it.
    document.body.insertAdjacentHTML(
      'beforeend',
      `<section class="eog-explorer"><div data-section="communities">
         <button class="eog-section__toggle" aria-expanded="false">Communities</button></div></section>`,
    )
    const toggle = document.querySelector<HTMLButtonElement>('.eog-section__toggle')!
    const unfold = vi.fn(() => toggle.setAttribute('aria-expanded', 'true'))
    toggle.addEventListener('click', unfold)
    Element.prototype.scrollIntoView = vi.fn()
    render(<ExplorerRail />)

    const rail = within(screen.getByRole('navigation', { name: 'Explorer sections' }))
    fireEvent.click(rail.getByRole('button', { name: 'Communities' }))

    expect(useAppStore.getState().panels.explorer).toBe(true)
    expect(unfold).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(toggle)
  })

  test('keeps the "Open explorer" button the rest of the app relies on', () => {
    render(<ExplorerRail />)

    fireEvent.click(screen.getByRole('button', { name: 'Open explorer' }))

    expect(useAppStore.getState().panels.explorer).toBe(true)
    expect(screen.getByRole('navigation', { name: 'Explorer sections' })).toBeDefined()
  })
})

describe('search shortcuts', () => {
  const model = adaptGraphify(makeRawGraph())
  const search = buildSearchIndex(model)

  test('⌘K and Ctrl K focus the search from anywhere, even from another field', () => {
    render(
      <>
        <input aria-label="Other field" />
        <SearchBox search={search} communities={model.communities} />
      </>,
    )
    const input = screen.getByRole('combobox', { name: 'Search the graph' })
    const other = screen.getByRole('textbox', { name: 'Other field' })

    other.focus()
    act(() => void fireEvent.keyDown(other, { key: 'k', ctrlKey: true }))
    expect(document.activeElement).toBe(input)

    input.blur()
    act(() => void fireEvent.keyDown(document.body, { key: 'K', metaKey: true }))
    expect(document.activeElement).toBe(input)
  })

  test('"/" focuses the search, but types normally inside another field', () => {
    render(
      <>
        <input aria-label="Other field" />
        <SearchBox search={search} communities={model.communities} />
      </>,
    )
    const input = screen.getByRole('combobox', { name: 'Search the graph' })
    const other = screen.getByRole('textbox', { name: 'Other field' })

    other.focus()
    fireEvent.keyDown(other, { key: '/' })
    expect(document.activeElement).toBe(other)

    other.blur()
    fireEvent.keyDown(document.body, { key: '/' })
    expect(document.activeElement).toBe(input)
    expect(input.getAttribute('aria-keyshortcuts')).toContain('Control+K')
  })
})

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { isNodeVisible } from '@/graph'
import { EMPTY_RESULTS, type SearchHit, type SearchIndex } from '@/search'
import { useScope } from '@/state/selectors'
import { useAppStore } from '@/state/store'
import type { Community } from '@/types/graph'
import { SearchIcon } from '@/ui/icons'
import { formatCount } from '@/ui/primitives'
import { communityColor } from '@/utils/color'

const FOCUS_SHORTCUT = '/'
// The path column is cut at its start (CSS direction: rtl); this mark keeps
// leading dots and slashes where they belong.
const LEFT_TO_RIGHT_MARK = '\u200e'

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

interface ResultOptionProps {
  readonly id: string
  readonly hit: SearchHit
  readonly communityName: string | undefined
  readonly isActive: boolean
  readonly isOutsideView: boolean
  readonly onPick: () => void
  readonly onHover: () => void
}

/** One result. Graph text is untrusted, so it is only ever rendered as text. */
function ResultOption({ id, hit, communityName, isActive, isOutsideView, onPick, onHover }: ResultOptionProps) {
  const { node } = hit
  return (
    <li
      id={id}
      role="option"
      className="eog-result"
      aria-selected={isActive}
      // Keeps focus in the input, so the list does not close before the click lands.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPick}
      onMouseMove={onHover}
    >
      <span className="eog-result__main">
        <span className="eog-result__name">{node.label}</span>
        <span className="eog-tag">{node.kind}</span>
        {isOutsideView && <span className="eog-tag eog-tag--accent">Outside view</span>}
      </span>
      <span className="eog-result__context">
        <span className="eog-swatch" style={{ background: communityColor(node.community) }} aria-hidden="true" />
        <span className="eog-result__path">{node.sourceFile ? `${LEFT_TO_RIGHT_MARK}${node.sourceFile}` : 'External reference'}</span>
        {communityName && <span className="eog-result__community">{communityName}</span>}
      </span>
    </li>
  )
}

interface SearchBoxProps {
  /** Absent until the graph is loaded: the field is then disabled. */
  readonly search?: SearchIndex
  readonly communities?: readonly Community[]
}

/**
 * Header search (combobox pattern). The query lives in the store; picking a
 * result goes through `revealNode`, the same path as any other selection.
 */
export function SearchBox({ search, communities }: SearchBoxProps) {
  const query = useAppStore((state) => state.searchQuery)
  const setQuery = useAppStore((state) => state.setSearchQuery)
  const revealNode = useAppStore((state) => state.revealNode)
  const filters = useAppStore((state) => state.filters)
  const scope = useScope()
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const results = useMemo(() => search?.search(query) ?? EMPTY_RESULTS, [search, query])
  const communityNames = useMemo(
    () => new Map((communities ?? []).map((community) => [community.id, community.name])),
    [communities],
  )
  const hasQuery = query.trim() !== ''
  const isListShown = isOpen && hasQuery
  const activeHit = results.hits[Math.min(activeIndex, results.hits.length - 1)]
  const optionId = (nodeIndex: number): string => `${listId}-option-${nodeIndex}`

  useEffect(() => {
    const focusSearch = (event: globalThis.KeyboardEvent): void => {
      // ⌘K / Ctrl K works from anywhere, even from another field; "/" only outside one.
      const isCommandKey = (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k'
      const isSlash = event.key === FOCUS_SHORTCUT && !event.metaKey && !event.ctrlKey && !event.altKey
      if (!isCommandKey && (!isSlash || isTypingTarget(event.target))) return
      event.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  const pick = (hit: SearchHit): void => {
    revealNode(hit.node.id)
    setQuery('')
    setIsOpen(false)
  }

  const moveActive = (step: number): void => {
    if (results.hits.length === 0) return
    setIsOpen(true)
    setActiveIndex((current) => (current + step + results.hits.length) % results.hits.length)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveActive(isListShown ? (event.key === 'ArrowDown' ? 1 : -1) : 0)
    } else if (event.key === 'Enter') {
      if (!isListShown || !activeHit) return
      event.preventDefault()
      pick(activeHit)
    } else if (event.key === 'Escape') {
      // First Escape cancels the search, the next one leaves the field.
      if (hasQuery || isOpen) {
        setQuery('')
        setIsOpen(false)
      } else {
        event.currentTarget.blur()
      }
    }
  }

  return (
    <div className="eog-search eog-topbar__search" data-open={isListShown}>
      <SearchIcon />
      <input
        ref={inputRef}
        id="eog-search"
        type="text"
        role="combobox"
        aria-label="Search the graph"
        aria-keyshortcuts="/ Control+K Meta+K"
        aria-expanded={isListShown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={isListShown && activeHit ? optionId(results.hits.indexOf(activeHit)) : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="Search the knowledge graph"
        disabled={!search}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveIndex(0)
          setIsOpen(true)
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        onKeyDown={handleKeyDown}
      />
      {!hasQuery && (
        <kbd className="eog-tag" aria-hidden="true">
          {FOCUS_SHORTCUT}
        </kbd>
      )}

      <div className="eog-results" hidden={!isListShown}>
        <ul id={listId} role="listbox" aria-label="Search results" className="eog-results__list">
          {results.hits.map((hit, hitIndex) => (
            <ResultOption
              key={hit.node.id}
              id={optionId(hitIndex)}
              hit={hit}
              communityName={
                hit.node.community === null ? undefined : communityNames.get(hit.node.community)
              }
              isActive={hit === activeHit}
              isOutsideView={!isNodeVisible(hit.node, filters, scope)}
              onPick={() => pick(hit)}
              onHover={() => setActiveIndex(hitIndex)}
            />
          ))}
        </ul>
        {results.total === 0 ? (
          <p className="eog-results__note">No matches. Try a name, a file path or a community.</p>
        ) : (
          <p className="eog-results__note">
            {formatCount(results.hits.length)} of {formatCount(results.total)} · ↑↓ move · ↵ select · esc close
          </p>
        )}
      </div>

      <p className="eog-sr-only" role="status">
        {isListShown ? `${formatCount(results.total)} results` : ''}
      </p>
    </div>
  )
}

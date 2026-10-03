import { useMemo, useState } from 'react'
import {
  filterConnections,
  sortConnections,
  type ConnectionDirection,
  type ConnectionFilter,
  type ConnectionSort,
  type NodeAnalysis,
  type NodeConnection,
  type RelationCount,
} from '@/graph'
import { ArrowInIcon, ArrowOutIcon, CloseIcon, LoopIcon } from '@/ui/icons'
import { EmptyState, formatCount, moveBetweenRows, Section } from '@/ui/primitives'
import { communityColor } from '@/utils/color'

const PAGE_SIZE = 25
/** Below this many rows sorting controls are noise, not help. */
const SORTABLE_FROM = 8
/** Graphify's value for relations read straight from the source: the default, so not flagged. */
const CERTAIN_CONFIDENCE = 'EXTRACTED'

const DIRECTION_TEXT: Readonly<Record<ConnectionDirection, string>> = {
  incoming: 'Incoming from',
  outgoing: 'Outgoing to',
  self: 'Self-reference',
}

const SORT_OPTIONS: readonly { readonly value: ConnectionSort; readonly label: string }[] = [
  { value: 'relation', label: 'Relation' },
  { value: 'name', label: 'Name' },
  { value: 'degree', label: 'Degree' },
]

function DirectionIcon({ direction }: { readonly direction: ConnectionDirection }) {
  if (direction === 'incoming') return <ArrowInIcon size={14} />
  if (direction === 'outgoing') return <ArrowOutIcon size={14} />
  return <LoopIcon size={14} />
}

interface RelationGroupProps {
  readonly title: string
  readonly direction: ConnectionDirection
  readonly total: number
  readonly counts: readonly RelationCount[]
  readonly filter: ConnectionFilter | null
  readonly onToggle: (filter: ConnectionFilter) => void
}

/** Relation types of one direction; each row narrows the connected-nodes list. */
function RelationGroup({ title, direction, total, counts, filter, onToggle }: RelationGroupProps) {
  return (
    <div className="eog-relgroup">
      <p className="eog-relgroup__title">
        <DirectionIcon direction={direction} />
        <span className="eog-label">{title}</span>
        <span className="eog-row__value">{formatCount(total)}</span>
      </p>
      {counts.length === 0 ? (
        <p className="eog-relgroup__none">None</p>
      ) : (
        <ul onKeyDown={moveBetweenRows}>
          {counts.map(({ relation, count }) => (
            <li key={relation}>
              <button
                type="button"
                className="eog-row"
                aria-pressed={filter?.direction === direction && filter.relation === relation}
                aria-label={`${title} ${relation}: ${formatCount(count)}. Show only these`}
                onClick={() => onToggle({ direction, relation })}
              >
                <span className="eog-row__name eog-mono">{relation}</span>
                <span
                  className="eog-relbar"
                  style={{ inlineSize: `${Math.max(6, Math.round((count / total) * 56))}px` }}
                  aria-hidden="true"
                />
                <span className="eog-row__value">{formatCount(count)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface ConnectionRowProps {
  readonly connection: NodeConnection
  readonly communityName: string | undefined
  readonly isOutsideView: boolean
  readonly onOpen: (nodeId: string) => void
}

function ConnectionRow({ connection, communityName, isOutsideView, onOpen }: ConnectionRowProps) {
  const { node, edge, direction } = connection
  const content = (
    <>
      <span className="eog-connection__direction" data-direction={direction}>
        <DirectionIcon direction={direction} />
      </span>
      <span className="eog-connection__body">
        <span className="eog-connection__main">
          <span className="eog-connection__name">{node.label}</span>
          <span className="eog-tag">{node.kind}</span>
        </span>
        <span className="eog-connection__meta">
          <span className="eog-mono eog-connection__relation">{edge.relation}</span>
          {edge.confidence !== CERTAIN_CONFIDENCE && <span className="eog-tag">{edge.confidence}</span>}
          {isOutsideView && <span className="eog-tag eog-tag--accent">Outside view</span>}
        </span>
        <span className="eog-connection__meta">
          <span className="eog-swatch" style={{ background: communityColor(node.community) }} aria-hidden="true" />
          <span className="eog-connection__community">{communityName ?? 'No community'}</span>
        </span>
      </span>
    </>
  )
  if (direction === 'self') {
    return (
      <li className="eog-connection" aria-label={`${DIRECTION_TEXT.self}, ${edge.relation}`}>
        {content}
      </li>
    )
  }
  return (
    <li>
      <button
        type="button"
        className="eog-connection"
        aria-label={`${DIRECTION_TEXT[direction]} ${node.label}, ${edge.relation}${isOutsideView ? ', outside the current view' : ''}. Inspect`}
        onClick={() => onOpen(node.id)}
      >
        {content}
      </button>
    </li>
  )
}

interface NodeRelationsProps {
  readonly analysis: NodeAnalysis
  readonly visibleNodeIds: ReadonlySet<string>
  readonly communityNames: ReadonlyMap<number, string>
  /** Goes through the store: the same path as any other selection. */
  readonly onOpen: (nodeId: string) => void
}

/**
 * Relationships (by direction and real relation type) and the nodes behind
 * them. Mounted with the node id as key, so its local controls reset per node.
 */
export function NodeRelations({ analysis, visibleNodeIds, communityNames, onOpen }: NodeRelationsProps) {
  const [filter, setFilter] = useState<ConnectionFilter | null>(null)
  const [sort, setSort] = useState<ConnectionSort>('relation')
  const [limit, setLimit] = useState(PAGE_SIZE)

  const rows = useMemo(
    () => sortConnections(filterConnections(analysis.connections, filter), sort),
    [analysis, filter, sort],
  )
  const shown = rows.slice(0, limit)
  const remaining = rows.length - shown.length

  const toggleFilter = (next: ConnectionFilter): void => {
    const isSame = filter?.direction === next.direction && filter.relation === next.relation
    setFilter(isSame ? null : next)
    setLimit(PAGE_SIZE)
  }

  if (analysis.relationCount === 0) {
    return (
      <Section title="Relationships" count={0}>
        <EmptyState compact title="No relationships" hint="This node is isolated: nothing points to it or from it." />
      </Section>
    )
  }

  return (
    <div
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !filter) return
        // Handled here: the global Escape must not also leave a path or an expansion.
        event.preventDefault()
        setFilter(null)
      }}
    >
      <Section title="Relationships" count={analysis.relationCount}>
        <RelationGroup
          title="Incoming"
          direction="incoming"
          total={analysis.incomingCount}
          counts={analysis.incoming}
          filter={filter}
          onToggle={toggleFilter}
        />
        <RelationGroup
          title="Outgoing"
          direction="outgoing"
          total={analysis.outgoingCount}
          counts={analysis.outgoing}
          filter={filter}
          onToggle={toggleFilter}
        />
      </Section>

      <Section title="Connected nodes" count={rows.length}>
        {filter && (
          <p className="eog-chip eog-connection-filter">
            <span className="eog-label">{filter.direction}</span>
            <span className="eog-chip__name eog-mono">{filter.relation}</span>
            <button
              type="button"
              className="eog-chip__clear"
              aria-label="Show every relationship"
              onClick={() => setFilter(null)}
            >
              <CloseIcon size={12} />
            </button>
          </p>
        )}
        {rows.length >= SORTABLE_FROM && (
          <div className="eog-segmented" role="group" aria-label="Sort connected nodes by">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={sort === option.value}
                onClick={() => setSort(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
        <ul className="eog-connections" onKeyDown={moveBetweenRows}>
          {shown.map((connection) => (
            <ConnectionRow
              key={connection.edge.id}
              connection={connection}
              communityName={
                connection.node.community === null
                  ? undefined
                  : communityNames.get(connection.node.community)
              }
              isOutsideView={!visibleNodeIds.has(connection.node.id)}
              onOpen={onOpen}
            />
          ))}
        </ul>
        {remaining > 0 && (
          <button
            type="button"
            className="eog-link eog-list-note"
            onClick={() => setLimit((current) => current + PAGE_SIZE)}
          >
            Show {formatCount(Math.min(PAGE_SIZE, remaining))} more ({formatCount(remaining)} left)
          </button>
        )}
      </Section>
    </div>
  )
}

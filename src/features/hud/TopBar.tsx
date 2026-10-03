import { SearchBox } from '@/features/search/SearchBox'
import { ShareButton } from './ShareButton'
import { useVisibility } from '@/state/selectors'
import { useAppStore } from '@/state/store'
import type { GraphModel } from '@/types/graph'
import { EyeSymbol } from '@/ui/icons'
import { formatCount, Stat, StatusIndicator, type StatusTone } from '@/ui/primitives'

function Wordmark() {
  return (
    <div className="eog-wordmark">
      <span className="eog-wordmark__symbol">
        <EyeSymbol />
      </span>
      <div>
        <h1 className="eog-wordmark__name">EYE OF GOD</h1>
        <span className="eog-wordmark__tagline">GRAPH INTELLIGENCE SYSTEM</span>
      </div>
    </div>
  )
}

interface SystemStatus {
  readonly tone: StatusTone
  readonly label: string
  readonly details: readonly string[]
}

function useSystemStatus(): SystemStatus {
  const status = useAppStore((state) => state.data.status)
  const isLayoutRunning = useAppStore((state) => state.isLayoutRunning)
  if (status === 'error') return { tone: 'error', label: 'Graph core error', details: [] }
  if (status !== 'ready') return { tone: 'busy', label: 'System initializing', details: [] }
  if (isLayoutRunning) {
    return { tone: 'busy', label: 'Computing layout', details: ['WebGL'] }
  }
  return { tone: 'ok', label: 'System online', details: ['WebGL', 'Layout ready'] }
}

/** "visible" alone when everything is drawn, "visible / total" while narrowed. */
function countOf(visible: number, total: number): { readonly value: string; readonly detail?: string } {
  return visible === total
    ? { value: formatCount(total) }
    : { value: formatCount(visible), detail: `/ ${formatCount(total)}` }
}

/** Primary figures of the world; they follow the filters and the scope. */
function GraphStats({ model }: { readonly model: GraphModel }) {
  const visibility = useVisibility(model)
  const { metadata } = model
  return (
    <dl className="eog-stats">
      <Stat label="Nodes" {...countOf(visibility.nodeIds.size, metadata.nodeCount)} />
      <Stat label="Relations" {...countOf(visibility.edgeCount, metadata.edgeCount)} />
      <Stat label="Communities" {...countOf(visibility.communityCount, metadata.communityCount)} />
    </dl>
  )
}

/** Not a navbar: three independent HUD clusters floating over the world. */
export function TopBar() {
  const status = useSystemStatus()
  const data = useAppStore((state) => state.data)
  const ready = data.status === 'ready' ? data : null
  return (
    <header className="eog-topbar">
      <Wordmark />
      <SearchBox search={ready?.search} communities={ready?.model.communities} />
      <div className="eog-topbar__end">
        {ready && <ShareButton />}
        <StatusIndicator {...status} />
        {ready && <GraphStats model={ready.model} />}
      </div>
    </header>
  )
}

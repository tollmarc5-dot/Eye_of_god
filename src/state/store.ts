import { create } from 'zustand'
import type { SchemaIssue } from '@/data'
import {
  DEFAULT_FILTERS,
  isNodeVisible,
  NO_AGGREGATION,
  revealNode as revealInView,
  withCommunityCollapsed,
  type Aggregation,
  type ExpansionDepth,
  type GraphIndex,
  type KnowledgeGraph,
} from '@/graph'
import type { ViewInfo } from '@/renderer/zoom-level'
import type { SearchIndex } from '@/search'
import type { CameraState, GraphFilters, GraphModel, GraphScope, PositionMap } from '@/types/graph'
import {
  DEFAULT_VIEW_STATE,
  type CameraView,
  type ViewState,
} from './url-state'

/** Pipeline step currently running, shown by the loading screen. */
export type LoadStage = 'fetching' | 'adapting' | 'layout'

export type GraphData =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly stage: LoadStage }
  | {
      readonly status: 'ready'
      readonly model: GraphModel
      readonly index: GraphIndex
      /** Text search over the model; independent from the renderer. */
      readonly search: SearchIndex
      /** Base graph with every node; filters never remove anything from it. */
      readonly graph: KnowledgeGraph
      /** Layout result by node id, kept apart from the semantic model. */
      readonly positions: PositionMap
    }
  | { readonly status: 'error'; readonly message: string; readonly issues: readonly SchemaIssue[] }

export type PanelId = 'explorer' | 'inspector'

/** Neighbourhood being explored. Only ids: the node set is derived (see selectors). */
export interface ExpansionRequest {
  readonly rootId: string
  readonly depth: ExpansionDepth
}

/**
 * "Path to" mode. `picking` waits for the destination: the next node that is
 * selected, by any means, becomes it. Only ids: the path itself is derived.
 */
export type PathRequest =
  | { readonly status: 'idle' }
  | { readonly status: 'picking'; readonly fromId: string }
  | { readonly status: 'set'; readonly fromId: string; readonly toId: string }

const NO_PATH: PathRequest = { status: 'idle' }
/** Oldest entries are dropped beyond this; ids are small, the cap is for sanity. */
export const MAX_HISTORY = 100

export interface Preferences {
  readonly theme: 'dark' | 'light'
  readonly showEdges: boolean
}

/** Timings in milliseconds, measured with performance.now(). */
export type Metrics = Readonly<Record<string, number>>

export interface AppState {
  readonly data: GraphData
  readonly isLayoutRunning: boolean
  readonly metrics: Metrics
  readonly selectedNodeId: string | null
  /**
   * Community being inspected. A node or a community is inspected, never both.
   * Not a filter: `activeCommunity` is the one that hides the rest of the graph.
   */
  readonly selectedCommunityId: number | null
  /** Which communities are drawn as one aggregate. Ids only: the aggregates are derived. */
  readonly aggregation: Aggregation
  readonly searchQuery: string
  readonly filters: GraphFilters
  /**
   * Scope of the exploration: which part of the graph is drawn. Not the same
   * thing as the selection, which only says which node is being inspected.
   */
  readonly activeCommunity: number | null
  /** '' is the bucket of root-level and external nodes. */
  readonly activeProject: string | null
  /** First-level folder inside `activeProject`; always null without a project. */
  readonly activeFolder: string | null
  /** Node the camera should travel to once it is drawn. Consumed by the world. */
  readonly focusRequest: string | null
  /** Zoom level and percentage, updated a few times per second at most. */
  readonly view: ViewInfo
  /** Where the camera is, reported throttled by the renderer. Read by the URL layer only. */
  readonly camera: CameraView | null
  /** Camera to put in place once the graph is drawn (a restored view). Consumed by the world. */
  readonly cameraRequest: CameraView | null
  readonly panels: Readonly<Record<PanelId, boolean>>
  /**
   * Visited node ids, oldest first; `historyIndex` points at the current one.
   * Only node navigation is recorded: never camera, filters or panels.
   */
  readonly history: readonly string[]
  readonly historyIndex: number
  readonly expansion: ExpansionRequest | null
  readonly path: PathRequest
  readonly preferences: Preferences

  setData(data: GraphData): void
  setLayoutRunning(isLayoutRunning: boolean): void
  recordMetrics(patch: Metrics): void
  selectNode(nodeId: string | null): void
  setSearchQuery(query: string): void
  setFilters(patch: Partial<GraphFilters>): void
  setActiveCommunity(community: number | null): void
  setActiveProject(project: string | null): void
  setActiveFolder(folder: string | null): void
  /** Drops project, folder and community: back to the whole graph. */
  clearScope(): void
  /** Global state: no scope, default filters, relations shown. The selection stays if still drawn. */
  resetExploration(): void
  /** Selects a node, widening filters and scope just enough to draw it, and asks for focus. */
  revealNode(nodeId: string): void
  clearFocusRequest(): void
  /** Moves through the history without recording a new entry. */
  goBack(): void
  goForward(): void
  /** Highlights the neighbourhood of a node up to `depth` hops; null turns it off. */
  setExpansion(nodeId: string, depth: ExpansionDepth | null): void
  /** Enters "path to" mode from the selected node. */
  startPath(): void
  /** Leaves path mode and removes the path, whatever its state. */
  clearPath(): void
  /** Inspects a community (null clears it). Deselects the node; records no history. */
  selectCommunity(communityId: number | null): void
  /** Draws one community as an aggregate, or as its nodes again. */
  setCommunityCollapsed(communityId: number, isCollapsed: boolean): void
  /** Community view: every community collapsed. Off returns to the node view. */
  setCommunityMode(isOn: boolean): void
  setView(view: ViewInfo): void
  setCamera(camera: CameraState): void
  clearCameraRequest(): void
  /** Replaces the persistible part of the state with a validated view (from a URL). */
  restoreView(view: ViewState): void
  setPanel(panel: PanelId, isOpen: boolean): void
  setPreferences(patch: Partial<Preferences>): void
}

export function scopeOf(state: Pick<AppState, 'activeProject' | 'activeFolder' | 'activeCommunity'>): GraphScope {
  return {
    project: state.activeProject,
    folder: state.activeFolder,
    community: state.activeCommunity,
  }
}

type ViewSlice = Pick<
  AppState,
  'data' | 'filters' | 'selectedNodeId' | 'activeProject' | 'activeFolder' | 'activeCommunity'
>

/**
 * Applies a change to filters or scope and keeps the selection coherent: a
 * selected node that the new view no longer draws is deselected.
 */
function withView(state: AppState, patch: Partial<ViewSlice>): Partial<AppState> {
  const next: ViewSlice = { ...state, ...patch }
  const { data, selectedNodeId } = next
  if (data.status !== 'ready' || selectedNodeId === null) return patch
  const node = data.index.nodeById.get(selectedNodeId)
  const isStillDrawn = node !== undefined && isNodeVisible(node, next.filters, scopeOf(next))
  return isStillDrawn ? patch : { ...patch, selectedNodeId: null, expansion: null }
}

/** What selecting `nodeId` does to the temporary navigation modes. */
function withModes(state: AppState, nodeId: string): Pick<AppState, 'path' | 'expansion'> {
  return {
    // While picking, the selected node is the destination of the path.
    path: state.path.status === 'picking' ? { status: 'set', fromId: state.path.fromId, toId: nodeId } : state.path,
    // An expansion belongs to its root: it ends when another node is selected.
    expansion: state.expansion?.rootId === nodeId ? state.expansion : null,
  }
}

/**
 * A node that is selected has to be drawn as a node: if its community is
 * collapsed, selecting the node expands it.
 */
function withNodeDrawn(state: AppState, nodeId: string): Pick<AppState, 'aggregation' | 'selectedCommunityId'> {
  const community = state.data.status === 'ready' ? state.data.index.nodeById.get(nodeId)?.community : null
  return {
    selectedCommunityId: null,
    aggregation:
      community === null || community === undefined
        ? state.aggregation
        : withCommunityCollapsed(state.aggregation, community, false),
  }
}

/** History bookkeeping shared by every way of selecting a node. */
function withSelection(state: AppState, nodeId: string): Partial<AppState> {
  // A selection always brings the inspector back into view.
  const panels = { ...state.panels, inspector: true }
  const base = {
    selectedNodeId: nodeId,
    panels,
    ...withModes(state, nodeId),
    ...withNodeDrawn(state, nodeId),
  }
  if (nodeId === state.history[state.historyIndex]) return base
  // Selecting after going back drops the "forward" part, like a browser.
  const history = [...state.history.slice(0, state.historyIndex + 1), nodeId].slice(-MAX_HISTORY)
  return { ...base, history, historyIndex: history.length - 1 }
}

/** Selects a node and widens filters and scope just enough to draw it. */
function withReveal(state: AppState, nodeId: string, selection: Partial<AppState>): AppState | Partial<AppState> {
  const node = state.data.status === 'ready' ? state.data.index.nodeById.get(nodeId) : undefined
  if (!node) return state
  const view = revealInView(node, state.filters, scopeOf(state))
  return {
    ...selection,
    filters: view.filters,
    activeProject: view.scope.project,
    activeFolder: view.scope.folder,
    activeCommunity: view.scope.community,
    focusRequest: nodeId,
  }
}

/** Jumps to another history entry: selects and focuses it without recording anything. */
function withHistoryStep(state: AppState, step: -1 | 1): AppState | Partial<AppState> {
  const historyIndex = state.historyIndex + step
  const nodeId = state.history[historyIndex]
  if (nodeId === undefined) return state
  return withReveal(state, nodeId, {
    selectedNodeId: nodeId,
    historyIndex,
    panels: { ...state.panels, inspector: true },
    ...withNodeDrawn(state, nodeId),
    // Going back is navigation, not picking a destination.
    expansion: state.expansion?.rootId === nodeId ? state.expansion : null,
  })
}

/**
 * The single home of global UI state. Components read slices via selectors.
 * Per-frame things (hover, camera) live in the renderer, never here.
 */
export const useAppStore = create<AppState>()((set) => ({
  data: { status: 'idle' },
  isLayoutRunning: false,
  metrics: {},
  selectedNodeId: null,
  selectedCommunityId: null,
  aggregation: NO_AGGREGATION,
  searchQuery: '',
  filters: DEFAULT_FILTERS,
  activeCommunity: null,
  activeProject: null,
  activeFolder: null,
  focusRequest: null,
  view: { level: 'universe', zoomPercent: 100 },
  camera: null,
  cameraRequest: null,
  panels: { explorer: true, inspector: true },
  history: [],
  historyIndex: -1,
  expansion: null,
  path: NO_PATH,
  preferences: { theme: 'dark', showEdges: true },

  setData: (data) => set({ data }),
  setLayoutRunning: (isLayoutRunning) => set({ isLayoutRunning }),
  recordMetrics: (patch) => set((state) => ({ metrics: { ...state.metrics, ...patch } })),
  selectNode: (nodeId) =>
    set((state) =>
      nodeId === null ? { selectedNodeId: null, expansion: null } : withSelection(state, nodeId),
    ),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setFilters: (patch) =>
    set((state) => withView(state, { filters: { ...state.filters, ...patch } })),
  setActiveCommunity: (activeCommunity) => set((state) => withView(state, { activeCommunity })),
  // Folders belong to one project, so changing project always drops the folder.
  setActiveProject: (activeProject) =>
    set((state) => withView(state, { activeProject, activeFolder: null })),
  setActiveFolder: (activeFolder) =>
    set((state) =>
      state.activeProject === null ? state : withView(state, { activeFolder }),
    ),
  clearScope: () => set({ activeProject: null, activeFolder: null, activeCommunity: null }),
  resetExploration: () =>
    set((state) => ({
      ...withView(state, {
        filters: DEFAULT_FILTERS,
        activeProject: null,
        activeFolder: null,
        activeCommunity: null,
      }),
      preferences: { ...state.preferences, showEdges: true },
    })),
  revealNode: (nodeId) => set((state) => withReveal(state, nodeId, withSelection(state, nodeId))),
  goBack: () => set((state) => withHistoryStep(state, -1)),
  goForward: () => set((state) => withHistoryStep(state, 1)),
  setExpansion: (nodeId, depth) =>
    set((state) => {
      if (depth === null) return { expansion: null }
      if (state.selectedNodeId !== nodeId) return state
      // One temporary mode at a time: an expansion replaces a shown path.
      return { expansion: { rootId: nodeId, depth }, path: NO_PATH }
    }),
  startPath: () =>
    set((state) =>
      state.selectedNodeId === null
        ? state
        : { path: { status: 'picking', fromId: state.selectedNodeId }, expansion: null },
    ),
  clearPath: () => set({ path: NO_PATH }),
  selectCommunity: (communityId) =>
    set((state) =>
      communityId === null
        ? { selectedCommunityId: null }
        : {
            selectedCommunityId: communityId,
            // One inspected thing at a time; an expansion ends with its root.
            selectedNodeId: null,
            expansion: null,
            panels: { ...state.panels, inspector: true },
          },
    ),
  setCommunityCollapsed: (communityId, isCollapsed) =>
    set((state) => {
      const aggregation = withCommunityCollapsed(state.aggregation, communityId, isCollapsed)
      if (!isCollapsed) return { aggregation }
      const selected =
        state.data.status === 'ready' && state.selectedNodeId
          ? state.data.index.nodeById.get(state.selectedNodeId)
          : undefined
      const hidesSelection = selected?.community === communityId
      return {
        aggregation,
        // Collapsing changes the structure of the view: temporary modes end.
        path: NO_PATH,
        expansion: null,
        // A collapsed node cannot stay selected: its community takes over.
        ...(hidesSelection ? { selectedNodeId: null, selectedCommunityId: communityId } : {}),
      }
    }),
  setCommunityMode: (isOn) =>
    set((state) => {
      if (!isOn) return { aggregation: NO_AGGREGATION }
      const selected =
        state.data.status === 'ready' && state.selectedNodeId
          ? state.data.index.nodeById.get(state.selectedNodeId)
          : undefined
      return {
        aggregation: { mode: 'communities', exceptions: [] },
        path: NO_PATH,
        expansion: null,
        selectedNodeId: null,
        selectedCommunityId: selected?.community ?? state.selectedCommunityId,
      }
    }),
  clearFocusRequest: () => set({ focusRequest: null }),
  setView: (view) =>
    set((state) =>
      state.view.level === view.level && state.view.zoomPercent === view.zoomPercent
        ? state
        : { view },
    ),
  setCamera: ({ x, y, ratio }) =>
    set((state) =>
      state.camera?.x === x && state.camera.y === y && state.camera.ratio === ratio
        ? state
        : { camera: { x, y, ratio } },
    ),
  clearCameraRequest: () => set({ cameraRequest: null }),
  restoreView: (view) =>
    set((state) => {
      // 1. Filters, scope and grouping: what is drawn.
      const drawn: AppState = {
        ...state,
        filters: { ...state.filters, hideThirdParty: !view.showThirdParty, hideIsolated: !view.showIsolated },
        preferences: { ...state.preferences, showEdges: view.showRelations },
        activeProject: view.project,
        activeFolder: view.folder,
        activeCommunity: view.onlyCommunity,
        aggregation: view.aggregation,
        selectedNodeId: null,
        selectedCommunityId: view.communityId,
        expansion: null,
        path: NO_PATH,
        focusRequest: null,
      }
      // 2. The node, through the usual path: if the view would hide it, it is revealed.
      const selected: AppState =
        view.nodeId === null
          ? drawn
          : { ...drawn, ...withReveal(drawn, view.nodeId, withSelection(drawn, view.nodeId)) }
      // 3. Temporary modes, then the camera: a restored camera replaces the automatic focus.
      return {
        ...selected,
        path: view.path ? { status: 'set', ...view.path } : NO_PATH,
        expansion:
          view.expansionDepth !== null && selected.selectedNodeId !== null
            ? { rootId: selected.selectedNodeId, depth: view.expansionDepth }
            : null,
        cameraRequest: view.camera,
        focusRequest: view.camera ? null : selected.focusRequest,
      }
    }),
  setPanel: (panel, isOpen) =>
    set((state) => ({ panels: { ...state.panels, [panel]: isOpen } })),
  setPreferences: (patch) =>
    set((state) => ({ preferences: { ...state.preferences, ...patch } })),
}))

/** STORE → the shareable part of it. The inverse of `restoreView`. */
export function snapshotView(state: AppState): ViewState {
  return {
    nodeId: state.selectedNodeId,
    communityId: state.selectedNodeId === null ? state.selectedCommunityId : null,
    project: state.activeProject,
    folder: state.activeFolder,
    onlyCommunity: state.activeCommunity,
    showThirdParty: !state.filters.hideThirdParty,
    showIsolated: !state.filters.hideIsolated,
    showRelations: state.preferences.showEdges,
    aggregation: state.aggregation,
    path: state.path.status === 'set' ? { fromId: state.path.fromId, toId: state.path.toId } : null,
    expansionDepth: state.expansion?.depth ?? DEFAULT_VIEW_STATE.expansionDepth,
    camera: state.camera,
  }
}

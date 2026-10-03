import {
  EXPANSION_DEPTHS,
  NO_AGGREGATION,
  projectKeyOf,
  topFolderOf,
  type Aggregation,
  type ExpansionDepth,
  type GraphIndex,
} from '@/graph'
import type { GraphModel } from '@/types/graph'

/**
 * The part of the application state that makes up a shareable view.
 * Ids and switches only: everything else is derived again from the graph.
 */
export interface ViewState {
  readonly nodeId: string | null
  /** Inspected community. Never set together with `nodeId`. */
  readonly communityId: number | null
  readonly project: string | null
  readonly folder: string | null
  /** "Show only this community" filter. */
  readonly onlyCommunity: number | null
  readonly showThirdParty: boolean
  readonly showIsolated: boolean
  readonly showRelations: boolean
  readonly aggregation: Aggregation
  /** Both ends of a shown path; the route itself is recomputed. */
  readonly path: { readonly fromId: string; readonly toId: string } | null
  /** Expansion of `nodeId`. */
  readonly expansionDepth: ExpansionDepth | null
  readonly camera: CameraView | null
}

/** Sigma camera, in the coordinates of the framed graph. No node positions involved. */
export interface CameraView {
  readonly x: number
  readonly y: number
  readonly ratio: number
}

export const DEFAULT_VIEW_STATE: ViewState = {
  nodeId: null,
  communityId: null,
  project: null,
  folder: null,
  onlyCommunity: null,
  showThirdParty: false,
  showIsolated: true,
  showRelations: true,
  aggregation: NO_AGGREGATION,
  path: null,
  expansionDepth: null,
  camera: null,
}

/**
 * URL contract. One query parameter per piece of state, readable and stable.
 * A parameter is only written when its value differs from the default.
 */
export const URL_PARAMS = {
  node: 'node',
  community: 'community',
  project: 'project',
  folder: 'folder',
  only: 'only',
  thirdParty: 'thirdParty',
  isolated: 'isolated',
  relations: 'relations',
  view: 'view',
  collapsed: 'collapsed',
  expanded: 'expanded',
  from: 'from',
  to: 'to',
  expand: 'expand',
  camera: 'cam',
} as const

const COMMUNITY_VIEW = 'communities'
const ON = '1'
const OFF = '0'
const LIST_SEPARATOR = ','
const CAMERA_DECIMALS = 3
/** Longest value accepted for an id: real ids stay under 100 characters. */
const MAX_ID_LENGTH = 200
/** More ids than this in one list is not a view someone built by hand. */
const MAX_LIST_LENGTH = 400
const DEFAULT_CAMERA: CameraView = { x: 0.5, y: 0.5, ratio: 1 }
const CAMERA_LIMITS = { minRatio: 0.01, maxRatio: 20, minPosition: -10, maxPosition: 11 } as const

function round(value: number): number {
  const factor = 10 ** CAMERA_DECIMALS
  return Math.round(value * factor) / factor
}

function isDefaultCamera(camera: CameraView): boolean {
  return (
    round(camera.x) === DEFAULT_CAMERA.x &&
    round(camera.y) === DEFAULT_CAMERA.y &&
    round(camera.ratio) === DEFAULT_CAMERA.ratio
  )
}

/**
 * STATE → URL. Returns the query string without the leading "?"; '' for the
 * default view. Deterministic: the same view always gives the same string.
 */
export function encodeViewState(view: ViewState): string {
  const params = new URLSearchParams()
  if (view.nodeId !== null) params.set(URL_PARAMS.node, view.nodeId)
  if (view.communityId !== null) params.set(URL_PARAMS.community, String(view.communityId))
  if (view.project !== null) params.set(URL_PARAMS.project, view.project)
  if (view.folder !== null) params.set(URL_PARAMS.folder, view.folder)
  if (view.onlyCommunity !== null) params.set(URL_PARAMS.only, String(view.onlyCommunity))
  if (view.showThirdParty) params.set(URL_PARAMS.thirdParty, ON)
  if (!view.showIsolated) params.set(URL_PARAMS.isolated, OFF)
  if (!view.showRelations) params.set(URL_PARAMS.relations, OFF)
  const isCommunityView = view.aggregation.mode === 'communities'
  if (isCommunityView) params.set(URL_PARAMS.view, COMMUNITY_VIEW)
  if (view.aggregation.exceptions.length > 0) {
    params.set(
      isCommunityView ? URL_PARAMS.expanded : URL_PARAMS.collapsed,
      [...view.aggregation.exceptions].sort((a, b) => a - b).join(LIST_SEPARATOR),
    )
  }
  if (view.path) {
    params.set(URL_PARAMS.from, view.path.fromId)
    params.set(URL_PARAMS.to, view.path.toId)
  }
  if (view.expansionDepth !== null) params.set(URL_PARAMS.expand, String(view.expansionDepth))
  if (view.camera && !isDefaultCamera(view.camera)) {
    params.set(
      URL_PARAMS.camera,
      [view.camera.x, view.camera.y, view.camera.ratio].map(round).join(LIST_SEPARATOR),
    )
  }
  return params.toString()
}

/** What a URL is checked against: the graph that is actually loaded. */
export interface DecodeContext {
  readonly model: GraphModel
  readonly index: GraphIndex
}

function readId(params: URLSearchParams, name: string): string | null {
  const value = params.get(name)
  return value !== null && value.length <= MAX_ID_LENGTH ? value : null
}

function readNodeId(params: URLSearchParams, name: string, context: DecodeContext): string | null {
  const value = readId(params, name)
  return value !== null && context.index.nodeById.has(value) ? value : null
}

/** A whole, non-negative number written in plain digits; anything else is not an id. */
function parseCommunityId(value: string | null, context: DecodeContext): number | null {
  if (value === null || !/^\d{1,9}$/.test(value)) return null
  const id = Number(value)
  return context.index.nodeIdsByCommunity.has(id) ? id : null
}

function readCommunityList(params: URLSearchParams, name: string, context: DecodeContext): number[] {
  const value = params.get(name)
  if (value === null) return []
  const ids = new Set<number>()
  for (const part of value.split(LIST_SEPARATOR).slice(0, MAX_LIST_LENGTH)) {
    const id = parseCommunityId(part, context)
    if (id !== null) ids.add(id)
  }
  return [...ids].sort((a, b) => a - b)
}

function readSwitch(params: URLSearchParams, name: string, fallback: boolean): boolean {
  const value = params.get(name)
  if (value === ON) return true
  if (value === OFF) return false
  return fallback
}

function readCamera(params: URLSearchParams): CameraView | null {
  const parts = (params.get(URL_PARAMS.camera) ?? '').split(LIST_SEPARATOR)
  if (parts.length !== 3 || parts.some((part) => !/^-?\d+(\.\d+)?$/.test(part))) return null
  const [x, y, ratio] = parts.map(Number) as [number, number, number]
  const isInRange =
    x >= CAMERA_LIMITS.minPosition &&
    x <= CAMERA_LIMITS.maxPosition &&
    y >= CAMERA_LIMITS.minPosition &&
    y <= CAMERA_LIMITS.maxPosition &&
    ratio >= CAMERA_LIMITS.minRatio &&
    ratio <= CAMERA_LIMITS.maxRatio
  return isInRange ? { x, y, ratio } : null
}

function readScope(
  params: URLSearchParams,
  context: DecodeContext,
): Pick<ViewState, 'project' | 'folder'> {
  const project = readId(params, URL_PARAMS.project)
  if (project === null || !(project in context.model.metadata.projectCounts)) {
    return { project: null, folder: null }
  }
  const folder = readId(params, URL_PARAMS.folder)
  const hasFolder =
    folder !== null &&
    context.model.nodes.some((node) => projectKeyOf(node) === project && topFolderOf(node) === folder)
  return { project, folder: hasFolder ? folder : null }
}

/**
 * URL → STATE. The URL is untrusted input: every value is checked for type,
 * range, length and existence in the loaded graph. Whatever does not hold is
 * ignored and the default is used; this never throws and never returns a
 * state that contradicts itself.
 */
export function decodeViewState(search: string, context: DecodeContext): ViewState {
  const params = new URLSearchParams(search)
  const nodeId = readNodeId(params, URL_PARAMS.node, context)
  const fromId = readNodeId(params, URL_PARAMS.from, context)
  const toId = readNodeId(params, URL_PARAMS.to, context)
  const path = fromId !== null && toId !== null ? { fromId, toId } : null
  const depth = Number(params.get(URL_PARAMS.expand))
  const isCommunityView = params.get(URL_PARAMS.view) === COMMUNITY_VIEW
  return {
    nodeId,
    // One inspected thing at a time: the node wins.
    communityId: nodeId === null ? parseCommunityId(params.get(URL_PARAMS.community), context) : null,
    ...readScope(params, context),
    onlyCommunity: parseCommunityId(params.get(URL_PARAMS.only), context),
    showThirdParty: readSwitch(params, URL_PARAMS.thirdParty, DEFAULT_VIEW_STATE.showThirdParty),
    showIsolated: readSwitch(params, URL_PARAMS.isolated, DEFAULT_VIEW_STATE.showIsolated),
    showRelations: readSwitch(params, URL_PARAMS.relations, DEFAULT_VIEW_STATE.showRelations),
    aggregation: {
      mode: isCommunityView ? 'communities' : 'nodes',
      exceptions: readCommunityList(
        params,
        isCommunityView ? URL_PARAMS.expanded : URL_PARAMS.collapsed,
        context,
      ),
    },
    path,
    // An expansion needs its root, and a shown path replaces it (as in the app).
    expansionDepth:
      nodeId !== null && path === null && EXPANSION_DEPTHS.includes(depth as ExpansionDepth)
        ? (depth as ExpansionDepth)
        : null,
    camera: readCamera(params),
  }
}

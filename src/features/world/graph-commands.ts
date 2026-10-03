import { createContext, useContext } from 'react'
import type { ExpansionDepth } from '@/graph'

/**
 * Imperative graph commands. HUD components call these instead of touching
 * the renderer, so camera movement never goes through React state.
 */
export interface GraphCommands {
  zoomIn(): void
  zoomOut(): void
  resetCamera(): void
  focusNode(nodeId: string): void
  /** Lights and frames the neighbourhood of a node up to `depth` hops; null turns it off. */
  expandNode(nodeId: string, depth: ExpansionDepth | null): void
  /** Frames a community: its aggregate when collapsed, all its drawn nodes otherwise. */
  focusCommunity(communityId: number): void
}

const NOOP_COMMANDS: GraphCommands = {
  zoomIn: () => {},
  zoomOut: () => {},
  resetCamera: () => {},
  focusNode: () => {},
  expandNode: () => {},
  focusCommunity: () => {},
}

export const GraphCommandsContext = createContext<GraphCommands>(NOOP_COMMANDS)

export function useGraphCommands(): GraphCommands {
  return useContext(GraphCommandsContext)
}

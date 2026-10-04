import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExplorerPanel } from '@/features/explorer/ExplorerPanel'
import { ErrorScreen, LoadingScreen } from '@/features/hud/BootScreen'
import { GraphControls } from '@/features/hud/GraphControls'
import { useNavigationKeys } from '@/features/hud/navigation-keys'
import { NavigationStatus } from '@/features/hud/NavigationStatus'
import { ViewReadout } from '@/features/hud/Readouts'
import { TopBar } from '@/features/hud/TopBar'
import { InspectorPanel } from '@/features/inspector/InspectorPanel'
import { GraphCommandsContext, type GraphCommands } from '@/features/world/graph-commands'
import { GraphWorld } from '@/features/world/GraphWorld'
import { WorldBackdrop } from '@/features/world/WorldBackdrop'
import type { GraphRenderer, ScreenRect } from '@/renderer'
import { loadGraphSession } from '@/state/graph-session'
import { useAppStore } from '@/state/store'
import { startUrlSync } from '@/state/url-sync'
import { PanelIcon } from './icons'
import { measureHudZones, useHudOcclusion } from './occlusion'
import { HudButton } from './primitives'
import { COMPACT_QUERY, keepOneSheetOnPhones, MOBILE_QUERY } from './responsive'

/** The world fills the screen; everything else is HUD floating above it. */
export function AppShell() {
  const data = useAppStore((state) => state.data)
  const panels = useAppStore((state) => state.panels)
  const setPanel = useAppStore((state) => state.setPanel)
  const selectedNodeId = useAppStore((state) => state.selectedNodeId)
  const [attempt, setAttempt] = useState(0)
  const rendererRef = useRef<GraphRenderer | null>(null)
  const hudRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    void loadGraphSession(controller.signal)
    return () => controller.abort()
  }, [attempt])

  // Less room, fewer panels: the inspector reopens by itself on selection.
  useEffect(() => {
    if (window.matchMedia(COMPACT_QUERY).matches) setPanel('inspector', false)
    if (window.matchMedia(MOBILE_QUERY).matches) setPanel('explorer', false)
  }, [setPanel])

  // On a phone the two panels share one bottom sheet: the one that opens replaces the other.
  useEffect(() => useAppStore.subscribe(keepOneSheetOnPhones), [])

  useNavigationKeys()

  // The HUD tells the renderer what it covers: labels avoid it, the camera frames around it.
  const reportOcclusion = useCallback((rects: readonly ScreenRect[]) => {
    rendererRef.current?.setOccludedRects(rects)
  }, [])
  useHudOcclusion(hudRef, reportOcclusion)
  const measureOccluded = useCallback(() => (hudRef.current ? measureHudZones(hudRef.current) : []), [])

  // The address bar follows the store from the moment a graph is on screen.
  const isReady = data.status === 'ready'
  useEffect(() => (isReady ? startUrlSync() : undefined), [isReady])

  const commands = useMemo<GraphCommands>(
    () => ({
      zoomIn: () => rendererRef.current?.zoomIn(),
      zoomOut: () => rendererRef.current?.zoomOut(),
      resetCamera: () => rendererRef.current?.resetCamera(),
      focusNode: (nodeId) => rendererRef.current?.focusNode(nodeId),
      // The store keeps what is expanded; the world frames it when it changes.
      expandNode: (nodeId, depth) => useAppStore.getState().setExpansion(nodeId, depth),
      focusCommunity: (communityId) => {
        const { data } = useAppStore.getState()
        if (data.status !== 'ready') return
        rendererRef.current?.frameNodes(data.index.nodeIdsByCommunity.get(communityId) ?? [])
      },
    }),
    [],
  )
  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  const selectedNode =
    data.status === 'ready' && selectedNodeId ? data.index.nodeById.get(selectedNodeId) : undefined

  return (
    <GraphCommandsContext.Provider value={commands}>
      <div className="eog-shell">
        <WorldBackdrop />
        {data.status === 'ready' && (
          <GraphWorld
            model={data.model}
            index={data.index}
            graph={data.graph}
            positions={data.positions}
            rendererRef={rendererRef}
            measureOccluded={measureOccluded}
          />
        )}

        <div className="eog-hud" ref={hudRef}>
          <TopBar />
          {data.status === 'ready' && (
            <>
              <ExplorerPanel model={data.model} index={data.index} />
              {!panels.explorer && (
                <div className="eog-panel-tab eog-panel-tab--left">
                  <HudButton
                    label="Open explorer"
                    iconOnly
                    tooltipSide="bottom"
                    tooltipAlign="start"
                    onClick={() => setPanel('explorer', true)}
                  >
                    <PanelIcon />
                  </HudButton>
                </div>
              )}
              <InspectorPanel model={data.model} index={data.index} graph={data.graph} />
              {!panels.inspector && (
                <div className="eog-panel-tab eog-panel-tab--right">
                  <HudButton
                    label="Open inspector"
                    iconOnly
                    tooltipSide="bottom"
                    tooltipAlign="end"
                    onClick={() => setPanel('inspector', true)}
                  >
                    <PanelIcon />
                  </HudButton>
                </div>
              )}
              <GraphControls />
              <NavigationStatus model={data.model} index={data.index} graph={data.graph} />
              <ViewReadout model={data.model} />
            </>
          )}
        </div>

        {(data.status === 'idle' || data.status === 'loading') && (
          <LoadingScreen stage={data.status === 'loading' ? data.stage : null} />
        )}
        {data.status === 'error' && (
          <ErrorScreen message={data.message} issues={data.issues} onRetry={retry} />
        )}

        <p className="eog-sr-only" role="status">
          {selectedNode
            ? `Selected ${selectedNode.label}, ${selectedNode.degree} connections`
            : 'No node selected'}
        </p>
      </div>
    </GraphCommandsContext.Provider>
  )
}

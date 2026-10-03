import { useGraphCommands } from '@/features/world/graph-commands'
import { useAppStore } from '@/state/store'
import { ArrowInIcon, ArrowOutIcon, ExpandIcon, MinusIcon, PlusIcon, ResetIcon, TargetIcon } from '@/ui/icons'
import { HudButton } from '@/ui/primitives'

/** Navigation and camera dock, bottom centre: out of the way of the graph's middle. */
export function GraphControls() {
  const commands = useGraphCommands()
  const selectedNodeId = useAppStore((state) => state.selectedNodeId)
  const panels = useAppStore((state) => state.panels)
  const setPanel = useAppStore((state) => state.setPanel)
  const canGoBack = useAppStore((state) => state.historyIndex > 0)
  const canGoForward = useAppStore((state) => state.historyIndex < state.history.length - 1)
  const goBack = useAppStore((state) => state.goBack)
  const goForward = useAppStore((state) => state.goForward)
  const isImmersive = !panels.explorer && !panels.inspector

  const toggleImmersive = () => {
    setPanel('explorer', isImmersive)
    setPanel('inspector', isImmersive)
  }

  return (
    <div className="eog-dock" role="toolbar" aria-label="Graph controls">
      <HudButton label="Back to the previous node ( [ )" iconOnly disabled={!canGoBack} onClick={goBack}>
        <ArrowInIcon />
      </HudButton>
      <HudButton label="Forward to the next node ( ] )" iconOnly disabled={!canGoForward} onClick={goForward}>
        <ArrowOutIcon />
      </HudButton>
      <span className="eog-dock__divider" aria-hidden="true" />
      <HudButton label="Zoom in" iconOnly onClick={commands.zoomIn}>
        <PlusIcon />
      </HudButton>
      <HudButton label="Zoom out" iconOnly onClick={commands.zoomOut}>
        <MinusIcon />
      </HudButton>
      <span className="eog-dock__divider" aria-hidden="true" />
      <HudButton label="Reset view" onClick={commands.resetCamera}>
        <ResetIcon />
        Reset
      </HudButton>
      <HudButton
        label={selectedNodeId ? 'Focus selected node' : 'Focus (select a node first)'}
        disabled={!selectedNodeId}
        onClick={() => selectedNodeId && commands.focusNode(selectedNodeId)}
      >
        <TargetIcon />
        Focus
      </HudButton>
      <span className="eog-dock__divider" aria-hidden="true" />
      <HudButton
        label={isImmersive ? 'Show panels' : 'Hide panels (full view)'}
        pressed={isImmersive}
        onClick={toggleImmersive}
      >
        <ExpandIcon />
        View
      </HudButton>
    </div>
  )
}

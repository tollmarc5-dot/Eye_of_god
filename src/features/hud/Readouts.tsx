import { folderLabel, projectLabel } from '@/features/explorer/explorer-data'
import type { ZoomLevel } from '@/renderer'
import { useAppStore } from '@/state/store'
import type { GraphModel } from '@/types/graph'
import { formatCount, Stat } from '@/ui/primitives'

const LEVEL_NAMES: Readonly<Record<ZoomLevel, string>> = {
  universe: 'Universe',
  structure: 'Structure',
  detail: 'Detail',
}

/** Where the camera is, bottom-right. Updates a few times per second at most. */
export function ViewReadout({ model }: { readonly model: GraphModel }) {
  const view = useAppStore((state) => state.view)
  const activeCommunity = useAppStore((state) => state.activeCommunity)
  const activeProject = useAppStore((state) => state.activeProject)
  const activeFolder = useAppStore((state) => state.activeFolder)
  const community = model.communities.find((candidate) => candidate.id === activeCommunity)
  const projectPath =
    activeProject === null
      ? null
      : [projectLabel(activeProject), activeFolder === null ? null : folderLabel(activeFolder)]
          .filter(Boolean)
          .join(' / ')
  return (
    <dl className="eog-readout">
      {projectPath !== null && <Stat label="Active project" value={projectPath} />}
      {community && <Stat label="Active community" value={community.name} />}
      <Stat label="View" value={LEVEL_NAMES[view.level]} />
      <Stat label="Zoom" value={`${formatCount(view.zoomPercent)}%`} />
    </dl>
  )
}

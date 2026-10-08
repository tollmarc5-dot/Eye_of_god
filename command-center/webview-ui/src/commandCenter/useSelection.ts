import { useCallback, useSyncExternalStore } from 'react';

import type { OfficeState } from '../office/engine/officeState.js';

/** The office's selected character, kept in sync with every selection path. */
export function useSelectedAgentId(officeState: OfficeState): number | null {
  const subscribe = useCallback(
    (listener: () => void) => officeState.onSelectionChange(listener),
    [officeState],
  );
  return useSyncExternalStore(
    subscribe,
    () => officeState.selectedAgentId,
    () => officeState.selectedAgentId,
  );
}

/**
 * Select a character and glide the camera to it. Uses the office's own
 * selection (white outline) and camera follow, which eases towards the
 * character every frame instead of jumping.
 */
export function focusCharacter(officeState: OfficeState, id: number): void {
  if (!officeState.characters.has(id)) return;
  officeState.selectedAgentId = id;
  officeState.cameraFollowId = id;
  officeState.cameraPointTarget = null;
}

export function clearSelection(officeState: OfficeState): void {
  officeState.selectedAgentId = null;
  officeState.cameraFollowId = null;
}

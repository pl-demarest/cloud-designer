import { createContext, useContext, type RefObject } from 'react';
import type { EditorEngine } from '../engine/EditorEngine';

/**
 * The editor's engine while it is mounted (useEditorEngine's ref), for the toolbar and panels to
 * call from event handlers; never read it during render. Without a provider it holds null, so a
 * panel rendered on its own (as in the unit tests) does nothing for engine actions.
 */
export const EngineContext = createContext<RefObject<EditorEngine | null>>({ current: null });

export function useEngine(): RefObject<EditorEngine | null> {
  return useContext(EngineContext);
}

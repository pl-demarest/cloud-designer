import { useCloudStore } from '../store/cloudStore';

/**
 * Asks, then replaces the cloud with the default preset as one undo step. The page is not
 * reloaded: the history and the view stay, and what was generated from the cloud before is
 * dropped (resetToDefault counts a replacement).
 */
export function confirmAndResetPreset(): void {
  if (!window.confirm('Reset to the default cloud? Undo brings this one back.')) return;
  const store = useCloudStore.getState();
  store.resetToDefault();
  store.commit();
}

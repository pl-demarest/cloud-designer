import { useEffect } from 'react';
import { useCloudStore } from '../../store/cloudStore';
import { historyShortcut, isEditableTarget } from '../shortcuts';

/**
 * The undo and redo keys, in one window listener for as long as the component is mounted. They
 * run the store's undo() and redo(), as the toolbar buttons do, except while focus is in a text
 * field (isEditableTarget), whose own undo they then are.
 */
export function useHistoryShortcuts(): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || isEditableTarget(e.target)) return;
      const action = historyShortcut(e);
      if (!action) return;
      e.preventDefault();
      const store = useCloudStore.getState();
      if (action === 'undo') store.undo();
      else store.redo();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

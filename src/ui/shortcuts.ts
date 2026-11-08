/**
 * The editor's keyboard shortcuts, as pure functions of the key event: which history action a
 * key asks for, and whether the key belongs to a text field instead.
 */

/** Input types without text entry, so without a text undo of their own. */
const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);

/**
 * Whether `target` takes text: a textarea, a select, a contenteditable element, or an input of
 * a text-entry type (text, number, search...). Ctrl+Z there is the field's own undo. A range,
 * checkbox or button is not one, so the history keys work while it has focus.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  return target.isContentEditable || target.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

type ShortcutKeys = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

/** The letter a key event names, in lower case: e.key for a Latin letter (any case, so Caps
 *  Lock does not matter), else the physical key (e.code 'KeyZ'), for non-Latin layouts. */
function letter(e: ShortcutKeys): string {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase();
  const code = /^Key([A-Z])$/.exec(e.code);
  return code ? code[1].toLowerCase() : '';
}

/**
 * The history action a key asks for: Ctrl or Cmd with Z undoes; with Shift+Z or Y it redoes.
 * Alt (AltGr on some layouts) makes it no shortcut.
 */
export function historyShortcut(e: ShortcutKeys): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const k = letter(e);
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (k === 'y' && !e.shiftKey) return 'redo';
  return null;
}

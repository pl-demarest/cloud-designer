import { useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useCloudStore } from '../../store/cloudStore';
import { historyShortcut } from '../shortcuts';
import { formatFixed } from './format';

interface Props {
  /** The accessible name: the inputs sit in rows without a label of their own. */
  label: string;
  /** For a visible <label htmlFor>. */
  id?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Decimals shown while the field is not being edited. */
  digits?: number;
}

/**
 * A number input that edits through a string draft: typing changes only the draft. Blur or Enter
 * parses it. An empty or non-numeric entry is rejected and the field shows the preset's value
 * again; a number is clamped to [min, max] and, if it differs from the value, goes to onChange
 * and is committed as one undo step. Escape drops the draft.
 *
 * Pasted text that is not a number literal, which the number input would alter (Chrome drops a
 * comma, so "1,5" became 15), is handled here: one decimal comma and no point is read as a point
 * ("1,5" is 1.5), anything else is refused. A plain number is pasted by the browser.
 *
 * The undo and redo keys do not reach the browser: Chrome keeps one undo list for all of a page's
 * text fields, and a field's typing leaves it once React writes the applied value, so its Ctrl+Z
 * edited another field (the cloud name). With a draft, Ctrl+Z drops it; without one, the keys
 * undo and redo the preset, as the toolbar does.
 */
export function NumberField({ label, id, value, onChange, min = -Infinity, max = Infinity, step, digits = 2 }: Props) {
  const [draft, setDraft] = useState<string | null>(null);

  function apply() {
    if (draft === null) return;
    setDraft(null);
    const text = draft.trim();
    const parsed = text === '' ? NaN : Number(text);
    if (!Number.isFinite(parsed)) return;
    // A typed -0 is stored as 0, which is what Export JSON writes for it (adding 0 changes no
    // other value).
    const next = Math.min(Math.max(parsed, min), max) + 0;
    if (Object.is(next, value)) return;
    onChange(next);
    useCloudStore.getState().commit();
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text').trim();
    if (text !== '' && Number.isFinite(Number(text))) return;
    e.preventDefault();
    const comma = /^[+-]?\d*,\d+$/.test(text) ? text.replace(',', '.') : null;
    if (comma !== null) setDraft(comma);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') apply();
    else if (e.key === 'Escape') setDraft(null);
    else {
      const action = historyShortcut(e);
      if (!action) return;
      e.preventDefault();
      if (draft !== null) {
        if (action === 'undo') setDraft(null);
      } else if (action === 'undo') {
        useCloudStore.getState().undo();
      } else {
        useCloudStore.getState().redo();
      }
    }
  }

  return (
    <input
      id={id}
      type="number"
      className="cp-input"
      aria-label={label}
      value={draft ?? formatFixed(value, digits)}
      min={Number.isFinite(min) ? min : undefined}
      max={Number.isFinite(max) ? max : undefined}
      step={step}
      onChange={(e) => setDraft(e.target.value)}
      onPaste={handlePaste}
      onBlur={apply}
      onKeyDown={handleKeyDown}
    />
  );
}

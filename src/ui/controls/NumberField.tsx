import { useState, type KeyboardEvent } from 'react';
import { useCloudStore } from '../../store/cloudStore';

interface Props {
  /** The accessible name: the inputs sit in rows without a label of their own. */
  label: string;
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
 */
export function NumberField({ label, value, onChange, min = -Infinity, max = Infinity, step, digits = 2 }: Props) {
  const [draft, setDraft] = useState<string | null>(null);

  function apply() {
    if (draft === null) return;
    setDraft(null);
    const text = draft.trim();
    const parsed = text === '' ? NaN : Number(text);
    if (!Number.isFinite(parsed)) return;
    const next = Math.min(Math.max(parsed, min), max);
    if (next === value) return;
    onChange(next);
    useCloudStore.getState().commit();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') apply();
    else if (e.key === 'Escape') setDraft(null);
  }

  return (
    <input
      type="number"
      className="cp-input"
      aria-label={label}
      value={draft ?? value.toFixed(digits)}
      min={Number.isFinite(min) ? min : undefined}
      max={Number.isFinite(max) ? max : undefined}
      step={step}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={apply}
      onKeyDown={handleKeyDown}
    />
  );
}

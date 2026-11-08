import { useEffect, useId, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useCloudStore } from '../../store/cloudStore';

interface Props {
  label: string;
  /** The accessible name, when the visible label alone is not enough ("X" under "Position"). */
  ariaLabel?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** A whole-number field (a segment count, a density): each value is rounded. */
  integer?: boolean;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}

/** The keys a range input steps on. */
const STEP_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);

const store = () => useCloudStore.getState();

/**
 * A labelled range input for one preset number. Each value goes to onChange as it changes; the
 * edit becomes one undo step. A pointer drag, and a step key from press to release (held, it
 * repeats), are history gestures. The native change event commits too, so a change made by
 * assistive technology is recorded. A press that changes nothing records nothing: commit()
 * skips a preset equal to the newest step.
 */
export function SliderRow({ label, ariaLabel, value, min, max, step = 0.01, integer = false, onChange, format }: Props) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const keyHeld = useRef(false);
  const display = format ? format(value) : value.toFixed(2);

  // React's onChange is the input event; the native change event fires once per release or step.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const commit = () => store().commit();
    input.addEventListener('change', commit);
    return () => input.removeEventListener('change', commit);
  }, []);

  function handlePointerDown(e: PointerEvent<HTMLInputElement>) {
    // The press takes the focus from any other field now (the browser moves it on the mousedown
    // that follows), so a field that records its edit on blur (a number field, the name) records
    // it before the gesture opens: a step of its own, not part of the drag's.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== e.currentTarget) active.blur();
    store().beginGesture();
    // On the window: the release can happen anywhere.
    const end = () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      store().endGesture();
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!STEP_KEYS.has(e.key) || keyHeld.current) return;
    keyHeld.current = true;
    store().beginGesture();
  }

  function endKeyGesture() {
    if (!keyHeld.current) return;
    keyHeld.current = false;
    store().endGesture();
  }

  return (
    <div className="slider-row">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-label={ariaLabel}
        aria-valuetext={display}
        ref={inputRef}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          onChange(integer ? Math.round(v) : v);
        }}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        onKeyUp={endKeyGesture}
        onBlur={endKeyGesture}
      />
      <span className="slider-value">{display}</span>
    </div>
  );
}

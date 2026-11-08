interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
  format?: (v: number) => string;
}

export function SliderRow({ label, value, min, max, step = 0.01, onChange, onCommit, format }: Props) {
  const display = format ? format(value) : value.toFixed(2);
  return (
    <div className="slider-row">
      <label>{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onMouseUp={onCommit}
        onTouchEnd={onCommit}
      />
      <span className="slider-value">{display}</span>
    </div>
  );
}

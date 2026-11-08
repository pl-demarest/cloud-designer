interface Props {
  /** The item's name, such as "Sphere 1 (sphere)". */
  label: string;
  expanded: boolean;
  /** The id of the item's body, which the toggle controls. */
  bodyId: string;
  onToggle: () => void;
  /** The remove button's accessible name, such as "Remove sphere 1". */
  removeLabel: string;
  onRemove: () => void;
}

/**
 * The header bar of a list item (a sphere, a spiral): a toggle button across the bar that
 * expands the item's body (aria-expanded, aria-controls), and a remove button beside it.
 */
export function ItemHeader({ label, expanded, bodyId, onToggle, removeLabel, onRemove }: Props) {
  return (
    <div className="swirl-item-bar">
      <button
        type="button"
        className="swirl-item-header"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span>{label}</span>
        <span aria-hidden="true">{expanded ? '▲' : '▼'}</span>
      </button>
      <button type="button" className="btn-remove" aria-label={removeLabel} onClick={onRemove}>
        ×
      </button>
    </div>
  );
}

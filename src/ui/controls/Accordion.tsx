import { useId, type ReactNode } from 'react';

interface Props {
  label: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * A collapsible sidebar section: a header button that reports its state (aria-expanded) and
 * names the region it controls (aria-controls), and that region, rendered only while open and
 * labelled by the header. The ids come from useId.
 */
export function Accordion({ label, open, onToggle, children }: Props) {
  const id = useId();
  const headerId = `${id}-header`;
  const bodyId = `${id}-body`;
  return (
    <div className="accordion">
      <button
        id={headerId}
        className={`accordion-header ${open ? 'open' : ''}`}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span>{label}</span>
        <span aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div id={bodyId} className="accordion-body" role="region" aria-labelledby={headerId}>
          {children}
        </div>
      )}
    </div>
  );
}

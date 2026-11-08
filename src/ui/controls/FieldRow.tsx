import { useId, type CSSProperties, type ReactNode } from 'react';

interface Props {
  label: string;
  title?: string;
  style?: CSSProperties;
  /** The control, given the id its label points at. */
  children: (id: string) => ReactNode;
}

/** A label and a select or checkbox in a .field-row, the label tied to the control. */
export function FieldRow({ label, title, style, children }: Props) {
  const id = useId();
  return (
    <div className="field-row" title={title} style={style}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

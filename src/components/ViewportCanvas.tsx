import type { RefObject } from 'react';

interface Props {
  /** App mounts the EditorEngine on this canvas (useEditorEngine). */
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

export function ViewportCanvas({ canvasRef }: Props) {
  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  );
}

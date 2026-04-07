import { useEffect, useRef } from 'react';
import { Viewport } from '../three/Viewport';

interface Props {
  onViewportReady: (vp: Viewport) => void;
}

export function ViewportCanvas({ onViewportReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef<Viewport | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const parent = canvas.parentElement!;

    const vp = new Viewport(canvas);
    vpRef.current = vp;
    vp.resize(parent.clientWidth, parent.clientHeight);
    vp.start();
    onViewportReady(vp);

    const ro = new ResizeObserver(() => {
      vp.resize(parent.clientWidth, parent.clientHeight);
    });
    ro.observe(parent);

    return () => {
      ro.disconnect();
      vp.dispose();
      vpRef.current = null;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  );
}

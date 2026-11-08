import { useLayoutEffect, useRef, type RefObject } from 'react';
import { EditorEngine, type EditorEngineOptions } from './EditorEngine';

/**
 * Mounts an EditorEngine on the canvas in `canvasRef` for as long as the component is mounted,
 * in one effect whose cleanup disposes it: React's StrictMode remount, or any other, builds a
 * fresh engine on a clean slate. The returned ref holds the engine while it is mounted (null
 * before and after); read it in event handlers, not during render.
 *
 * A layout effect, so that the cleanup runs before React detaches the canvas: OrbitControls
 * removes its keydown listener from canvas.getRootNode(), which is the document only while the
 * canvas is attached. A passive effect's cleanup runs after the detach and left the listener on
 * the document.
 *
 * `options` is read once per mount: pass a constant, not an object literal, or every render
 * remounts the engine.
 */
export function useEditorEngine(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options?: EditorEngineOptions,
): RefObject<EditorEngine | null> {
  const engineRef = useRef<EditorEngine | null>(null);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new EditorEngine(canvas, options);
    engineRef.current = engine;
    return () => {
      engineRef.current = null;
      engine.dispose();
    };
  }, [canvasRef, options]);
  return engineRef;
}

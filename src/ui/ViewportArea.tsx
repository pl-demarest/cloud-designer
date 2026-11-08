import { useState, type DragEvent, type ReactNode } from 'react';
import { importPresetFile } from './importPreset';

const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

/**
 * The viewport's frame: a preset JSON file dropped on it is imported (importPresetFile, the
 * first file of a drop). The frame is outlined while a file is dragged over it.
 */
export function ViewportArea({ children }: { children: ReactNode }) {
  const [dropTarget, setDropTarget] = useState(false);

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropTarget(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDropTarget(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    setDropTarget(false);
    const file = e.dataTransfer.files[0];
    if (file) void importPresetFile(file);
  }

  return (
    <div
      className={dropTarget ? 'viewport-wrap drop-target' : 'viewport-wrap'}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
    </div>
  );
}

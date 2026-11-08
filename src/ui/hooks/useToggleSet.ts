import { useCallback, useState } from 'react';

/** A set of items in component state and a function that adds an item, or removes it if present. */
export function useToggleSet<T>(initial: Iterable<T> = []): [ReadonlySet<T>, (item: T) => void] {
  const [items, setItems] = useState<ReadonlySet<T>>(() => new Set(initial));
  const toggle = useCallback((item: T) => {
    setItems((prev) => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
  }, []);
  return [items, toggle];
}

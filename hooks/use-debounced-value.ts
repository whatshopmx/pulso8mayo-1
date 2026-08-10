import { useEffect, useState } from 'react';

/**
 * Returns `value` after `delay` ms of stability.
 * Used to debounce search inputs so keystrokes don't fire a request each.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
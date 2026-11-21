import { useState, type Dispatch, type SetStateAction } from "react";

/**
 * Local state that starts from `source` and resets whenever `source` changes,
 * while still being editable in between (a search box that follows the URL,
 * a form field that follows a saved record).
 *
 * The reset happens during render, which is how React recommends adjusting
 * state when a prop changes; doing it in an effect paints the stale value
 * first and renders twice.
 */
export function useSyncedState<T>(source: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(source);
  const [seen, setSeen] = useState(source);
  if (!Object.is(seen, source)) {
    setSeen(source);
    setValue(source);
  }
  return [value, setValue];
}

/**
 * Runs `onChange` during render whenever `value` changes (not on first render).
 * For state updates that should follow a value, such as a server action result,
 * without an effect.
 */
export function useOnChange<T>(value: T, onChange: (next: T, previous: T) => void): void {
  const [seen, setSeen] = useState(value);
  if (!Object.is(seen, value)) {
    setSeen(value);
    onChange(value, seen);
  }
}

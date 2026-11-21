import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * True in the browser, false during server rendering and hydration. The
 * React-sanctioned replacement for `useEffect(() => setMounted(true), [])`,
 * used before portalling into document.body.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

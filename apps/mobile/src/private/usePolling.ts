import { useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";

/** Repite `fn` cada `ms` mientras la pantalla tiene el foco. `ms = null` lo detiene. */
export function usePolling(fn: () => Promise<unknown> | void, ms: number | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useFocusEffect(
    useCallback(() => {
      if (ms === null) return undefined;
      const t = setInterval(() => void ref.current(), ms);
      return () => clearInterval(t);
    }, [ms]),
  );
}

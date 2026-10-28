import { useSyncExternalStore } from "react";

/** Store mínimo con useSyncExternalStore (sin dependencias). */
export type Store<S> = {
  get: () => S;
  set: (next: Partial<S> | ((s: S) => Partial<S>)) => void;
  subscribe: (fn: () => void) => () => void;
  reset: (s: S) => void;
};

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    get: () => state,
    set: (next) => {
      const patch = typeof next === "function" ? next(state) : next;
      state = { ...state, ...patch };
      emit();
    },
    reset: (s) => {
      state = s;
      emit();
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function useStore<S extends object, T>(store: Store<S>, selector: (s: S) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  );
}

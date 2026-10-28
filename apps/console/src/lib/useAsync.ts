import { useCallback, useEffect, useState } from "react";

export interface AsyncState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
  setData: (update: T | ((prev: T | undefined) => T)) => void;
}

interface Result<T> {
  key: string;
  tag: string;
  data?: T;
  error?: unknown;
}

/**
 * Carga datos asíncronos atados a una clave. Si la clave cambia, los datos anteriores no se
 * muestran (evita ver el vínculo anterior mientras carga el siguiente); `reload` conserva los datos
 * mientras recarga.
 */
export function useAsync<T>(fn: () => Promise<T>, key: string): AsyncState<T> {
  const [nonce, setNonce] = useState(0);
  const [res, setRes] = useState<Result<T>>({ key: "", tag: "" });
  const tag = `${key}#${nonce}`;

  useEffect(() => {
    let alive = true;
    fn().then(
      (data) => {
        if (alive) setRes({ key, tag, data });
      },
      (error: unknown) => {
        if (alive) setRes((prev) => ({ key, tag, data: prev.key === key ? prev.data : undefined, error }));
      },
    );
    return () => {
      alive = false;
    };
    // `fn` cambia en cada render; la clave describe por completo qué se carga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback((update: T | ((prev: T | undefined) => T)) => {
    setRes((prev) => ({
      ...prev,
      data: typeof update === "function" ? (update as (p: T | undefined) => T)(prev.data) : update,
    }));
  }, []);

  const sameKey = res.key === key;
  return {
    data: sameKey ? res.data : undefined,
    error: res.tag === tag ? res.error : undefined,
    loading: res.tag !== tag,
    reload,
    setData,
  };
}

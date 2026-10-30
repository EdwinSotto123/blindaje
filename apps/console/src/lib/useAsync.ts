import { useCallback, useEffect, useState } from "react";

export interface AsyncState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
  setData: (update: T | ((prev: T | undefined) => T)) => void;
}

/**
 * Últimos datos de cada clave en esta pestaña. Al volver a una vista se muestran al instante
 * mientras se recargan (las vistas solo muestran "Cargando" si no hay datos). Se vacía al entrar
 * y al salir: otra cuenta nunca ve lo que cargó la anterior.
 */
const lastData = new Map<string, unknown>();

export function clearAsyncCache(): void {
  lastData.clear();
}

interface Result<T> {
  key: string;
  tag: string;
  data?: T;
  error?: unknown;
}

/**
 * Carga datos asíncronos atados a una clave. Si la clave cambia, los datos de la clave anterior no
 * se muestran (evita ver el vínculo anterior mientras carga el siguiente), pero sí los últimos de la
 * clave nueva si ya se cargó antes; `reload` conserva los datos mientras recarga.
 */
export function useAsync<T>(fn: () => Promise<T>, key: string): AsyncState<T> {
  const [nonce, setNonce] = useState(0);
  const [res, setRes] = useState<Result<T>>({ key: "", tag: "" });
  const tag = `${key}#${nonce}`;

  useEffect(() => {
    let alive = true;
    fn().then(
      (data) => {
        lastData.set(key, data);
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
    setRes((prev) => {
      const data = typeof update === "function" ? (update as (p: T | undefined) => T)(prev.data) : update;
      if (prev.key) lastData.set(prev.key, data);
      return { ...prev, data };
    });
  }, []);

  const sameKey = res.key === key;
  return {
    data: sameKey ? res.data : (lastData.get(key) as T | undefined),
    error: res.tag === tag ? res.error : undefined,
    loading: res.tag !== tag,
    reload,
    setData,
  };
}

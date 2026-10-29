import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { HealthResponse, PortalApi } from "../api/api";

/**
 * El portal es público: no hay cuenta ni sesión. El contexto solo lleva la API y si lo que se ve es
 * una demostración (para la marca "Datos ficticios").
 */
interface SiteValue {
  api: PortalApi;
  isDemo: boolean;
  /** Una respuesta con `demo: true` enciende la marca aunque /v1/health diga producción. */
  markDemo: () => void;
}

const SiteContext = createContext<SiteValue | null>(null);

function useSite(): SiteValue {
  const v = useContext(SiteContext);
  if (!v) throw new Error("useSite fuera de AppProviders");
  return v;
}

export function useApi(): PortalApi {
  return useSite().api;
}

export function useIsDemo(): boolean {
  return useSite().isDemo;
}

/** Si los datos cargados son de demostración, la marca "Datos ficticios" queda a la vista. */
export function useDemoData(demo: boolean | undefined): void {
  const { markDemo } = useSite();
  useEffect(() => {
    if (demo) markDemo();
  }, [demo, markDemo]);
}

export function AppProviders({ api, children }: { api: PortalApi; children: ReactNode }) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [sawDemo, setSawDemo] = useState(false);

  useEffect(() => {
    let alive = true;
    api.health().then(
      (h) => {
        if (alive) setHealth(h);
      },
      () => {
        if (alive) setHealth(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [api]);

  const markDemo = useCallback(() => setSawDemo(true), []);

  // Todo Blindaje del hackathon es demostración: la marca "Datos ficticios" se quita solo si
  // /v1/health dice explícitamente que el entorno es de producción y ninguna respuesta trae demo.
  const isDemo = api.mode === "mock" || sawDemo || !/^prod/i.test(health?.env ?? "demo");

  const value = useMemo<SiteValue>(() => ({ api, isDemo, markDemo }), [api, isDemo, markDemo]);

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

import type { BusinessMe } from "@blindaje/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { HealthResponse, PortalApi } from "../api/api";

const ApiContext = createContext<PortalApi | null>(null);

export function useApi(): PortalApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi fuera de AppProviders");
  return api;
}

type AuthStatus = "loading" | "anon" | "authed";

interface AuthValue {
  status: AuthStatus;
  me: BusinessMe | null;
  /** true si la sesión se cerró porque el refresh falló. */
  expired: boolean;
  /** true si la sesión se cerró con "Cerrar sesión" (no se vuelve a la página anterior). */
  loggedOut: boolean;
  isDemo: boolean;
  login: (email: string, password: string) => Promise<BusinessMe>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth fuera de AppProviders");
  return v;
}

/** Negocio con sesión (solo dentro de rutas protegidas). */
export function useMe(): BusinessMe {
  const { me } = useAuth();
  if (!me) throw new Error("useMe sin sesión");
  return me;
}

export function AppProviders({ api, children }: { api: PortalApi; children: ReactNode }) {
  const [state, setState] = useState<{ status: AuthStatus; me: BusinessMe | null; expired: boolean; loggedOut: boolean }>({
    status: "loading",
    me: null,
    expired: false,
    loggedOut: false,
  });
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    let alive = true;
    api.onSessionExpired(() => {
      if (alive) setState({ status: "anon", me: null, expired: true, loggedOut: false });
    });
    api.restore().then(
      (me) => {
        if (alive) setState({ status: me ? "authed" : "anon", me, expired: false, loggedOut: false });
      },
      () => {
        if (alive) setState({ status: "anon", me: null, expired: false, loggedOut: false });
      },
    );
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

  const login = useCallback(
    async (email: string, password: string) => {
      const me = await api.login(email, password);
      setState({ status: "authed", me, expired: false, loggedOut: false });
      return me;
    },
    [api],
  );

  const logout = useCallback(async () => {
    await api.logout();
    setState({ status: "anon", me: null, expired: false, loggedOut: true });
  }, [api]);

  // Todo Blindaje del hackathon es demostración: la marca "Datos ficticios" se quita solo si
  // /v1/health dice explícitamente que el entorno es de producción.
  const isDemo = api.mode === "mock" || !/^prod/i.test(health?.env ?? "demo");

  const value = useMemo<AuthValue>(() => ({ ...state, isDemo, login, logout }), [state, isDemo, login, logout]);

  return (
    <ApiContext.Provider value={api}>
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    </ApiContext.Provider>
  );
}

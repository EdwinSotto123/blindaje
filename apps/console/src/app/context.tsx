import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { BlindajeApi } from "../api/api";
import type { ConsoleUser, HealthResponse } from "../api/types";

const ApiContext = createContext<BlindajeApi | null>(null);

export function useApi(): BlindajeApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi fuera de ApiProvider");
  return api;
}

type AuthStatus = "loading" | "anon" | "authed";

interface AuthValue {
  status: AuthStatus;
  user: ConsoleUser | null;
  /** true si la sesión se cerró porque el refresh falló. */
  expired: boolean;
  /** true si la sesión se cerró con "Cerrar sesión" (no se vuelve a la página anterior). */
  loggedOut: boolean;
  health: HealthResponse | null;
  isDemo: boolean;
  login: (email: string, password: string) => Promise<ConsoleUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth fuera de AppProviders");
  return v;
}

/** Usuario autenticado (solo dentro de rutas protegidas). */
export function useUser(): ConsoleUser {
  const { user } = useAuth();
  if (!user) throw new Error("useUser sin sesión");
  return user;
}

export function AppProviders({ api, children }: { api: BlindajeApi; children: ReactNode }) {
  const [state, setState] = useState<{ status: AuthStatus; user: ConsoleUser | null; expired: boolean; loggedOut: boolean }>({
    status: "loading",
    user: null,
    expired: false,
    loggedOut: false,
  });
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    let alive = true;
    api.onSessionExpired(() => {
      if (alive) setState({ status: "anon", user: null, expired: true, loggedOut: false });
    });
    api.restore().then(
      (user) => {
        if (alive) setState({ status: user ? "authed" : "anon", user, expired: false, loggedOut: false });
      },
      () => {
        if (alive) setState({ status: "anon", user: null, expired: false, loggedOut: false });
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
      const user = await api.login(email, password);
      setState({ status: "authed", user, expired: false, loggedOut: false });
      return user;
    },
    [api],
  );

  const logout = useCallback(async () => {
    await api.logout();
    setState({ status: "anon", user: null, expired: false, loggedOut: true });
  }, [api]);

  const isDemo = api.mode === "mock" || /demo/i.test(health?.env ?? "");

  const value = useMemo<AuthValue>(
    () => ({ ...state, health, isDemo, login, logout }),
    [state, health, isDemo, login, logout],
  );

  return (
    <ApiContext.Provider value={api}>
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    </ApiContext.Provider>
  );
}

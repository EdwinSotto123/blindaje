import type { BusinessMe, BusinessRecommendationView, RiskOverview, VictimAlert } from "@blindaje/shared";

/** GET /v1/health → `{ ok, env, version }` (docs/API.md). */
export interface HealthResponse {
  ok: boolean;
  env: string;
  version: string;
}

/**
 * Todo lo que el portal le pide al backend (docs/API.md, sección Negocios). Lo implementan
 * `HttpPortalApi` (API real) y `MockPortalApi` (modo simulado con la historia ficticia de Lima Este).
 *
 * Solo hay lecturas agregadas: a propósito, no existe ninguna búsqueda por número, cuenta ni placa.
 */
export interface PortalApi {
  readonly mode: "http" | "mock";

  health(): Promise<HealthResponse>;

  // Sesión
  login(email: string, password: string): Promise<BusinessMe>;
  /** Recupera la sesión guardada en la pestaña, si existe. */
  restore(): Promise<BusinessMe | null>;
  logout(): Promise<void>;
  /** Borra la sesión de la pestaña sin esperar a la red (Salir rápido). */
  forget(): void;
  onSessionExpired(cb: () => void): void;

  // Inteligencia agregada de su organización
  risk(opts?: { zona?: string; sector?: string }): Promise<RiskOverview>;
  recommendations(): Promise<BusinessRecommendationView[]>;
  alerts(): Promise<VictimAlert[]>;
}

import type { BusinessRecommendationView, PublicRiskOverview, PublicZoneMap, VictimAlert } from "@blindaje/shared";

/** GET /v1/health → `{ ok, env, version }` (docs/API.md). */
export interface HealthResponse {
  ok: boolean;
  env: string;
  version: string;
}

export interface ZoneQuery {
  /** Id de distrito (`DISTRICTS[].id`). */
  zona: string;
  /** Rubro (enum Sector). Sin rubro, todos los rubros del distrito. */
  sector?: string | null;
}

/**
 * Todo lo que el portal público le pide al backend (docs/API.md, rutas /v1/public). Lo implementan
 * `HttpPortalApi` (API real) y `MockPortalApi` (modo simulado con distritos ficticios).
 *
 * Sin cuenta ni sesión, y solo lecturas agregadas por distrito: a propósito, no existe ninguna
 * búsqueda por número, cuenta ni placa, ni nada más fino que un distrito.
 */
export interface PortalApi {
  readonly mode: "http" | "mock";

  health(): Promise<HealthResponse>;

  /** GET /v1/public/zones: el mapa de los 50 distritos, con niveles y rangos. */
  zones(): Promise<PublicZoneMap>;
  /** GET /v1/public/risk?zona=&sector=: el panorama de un distrito, con rangos. */
  risk(q: ZoneQuery): Promise<PublicRiskOverview>;
  /** GET /v1/public/recommendations?zona=&sector=: consejos aprobados por el equipo de Blindaje. */
  recommendations(q: ZoneQuery): Promise<BusinessRecommendationView[]>;
  /** GET /v1/public/alerts?zona=: avisos aprobados por el equipo de Blindaje para el distrito. */
  alerts(q: { zona: string }): Promise<VictimAlert[]>;
}

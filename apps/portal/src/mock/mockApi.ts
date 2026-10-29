import { districtById, type BusinessRecommendationView, type PublicRiskOverview, type PublicZoneMap, type VictimAlert } from "@blindaje/shared";
import type { HealthResponse, PortalApi, ZoneQuery } from "../api/api";
import { ApiRequestError } from "../api/client";
import { RUBROS } from "../lib/choice";
import { sanitizeAlerts, sanitizeRecommendations, sanitizeRisk, sanitizeZones } from "../lib/publicData";
import { publicAlerts, publicRecommendations, publicRisk, publicZones } from "./fixtures";

export interface MockOptions {
  /** Milisegundos de espera simulada por llamada (0 en tests). */
  latency?: number;
}

/**
 * API simulada con distritos ficticios. Mismo contrato y mismas reglas que las rutas públicas de la
 * API: sin cuenta, solo rangos, sin totales, y un distrito bajo el umbral se ve "sin datos". Nunca
 * hay búsqueda por número, cuenta ni placa.
 */
export class MockPortalApi implements PortalApi {
  readonly mode = "mock" as const;
  private readonly latency: number;

  constructor(opts: MockOptions = {}) {
    this.latency = opts.latency ?? 260;
  }

  private async wait(): Promise<void> {
    if (this.latency > 0) await new Promise((r) => setTimeout(r, this.latency));
  }

  /** Como la API: el distrito tiene que ser uno de la lista y el rubro, uno del enum. */
  private check(q: { zona: string; sector?: string | null }): { zona: string; sector: string | null } {
    if (!districtById(q.zona)) throw new ApiRequestError(400, "bad_request", "Ese distrito no está en la lista. Elige uno de Lima o el Callao.");
    const sector = q.sector || null;
    if (sector && !(RUBROS as readonly string[]).includes(sector)) throw new ApiRequestError(400, "bad_request", "Ese rubro no está en la lista.");
    return { zona: q.zona, sector };
  }

  async health(): Promise<HealthResponse> {
    return { ok: true, env: "demo-simulado", version: "simulado" };
  }

  async zones(): Promise<PublicZoneMap> {
    await this.wait();
    return sanitizeZones(publicZones());
  }

  async risk(q: ZoneQuery): Promise<PublicRiskOverview> {
    const { zona, sector } = this.check(q);
    await this.wait();
    return sanitizeRisk(publicRisk(zona, sector));
  }

  async recommendations(q: ZoneQuery): Promise<BusinessRecommendationView[]> {
    const { zona, sector } = this.check(q);
    await this.wait();
    return sanitizeRecommendations(publicRecommendations(zona, sector), zona);
  }

  async alerts(q: { zona: string }): Promise<VictimAlert[]> {
    const { zona } = this.check(q);
    await this.wait();
    return sanitizeAlerts(publicAlerts(zona), zona);
  }
}
